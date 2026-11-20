"""Definição dos workflows LIS. Rode: python3 workflows.py  (IDs dos sub-workflows em ids.json)"""
import json, pathlib
from gerar import *

IDS = json.loads((OUT / 'ids.json').read_text()) if (OUT / 'ids.json').exists() else {}
ID = lambda k: IDS.get(k, 'PREENCHER_' + k)
PROMPT = (OUT.parent / 'agente' / 'prompt-laura.md').read_text().split('<!-- PROMPT -->', 1)[1].strip()

# ------------------------------------------------------------------ LIS · WA Enviar
src = HEAD + CREDS
src += exec_trigger('recebe', 'Recebe resposta para enviar', ['lead_id', 'telefone', 'texto'])
src += rpc('cfg', 'Config Evolution', 'sdr_evo_config')
src += code('dividir', 'Dividir em mensagens', r"""const t = String($('Recebe resposta para enviar').first().json.texto || '').trim();
if (!t || t.toUpperCase() === 'NO_REPLY') return [];
const partes = t.split(/\n\s*---\s*\n|^\s*---\s*$/m).map(s => s.trim()).filter(s => s && s.toUpperCase() !== 'NO_REPLY').slice(0, 3);
return partes.map((texto, i) => ({ json: { texto, ordem: i } }));""")
src += rpc('registrar', 'Registrar e checar repetição', 'sdr_outbound',
           "={{ JSON.stringify({ p_lead_id: $('Recebe resposta para enviar').first().json.lead_id, p_content: $json.texto, p_sender: 'ia' }) }}")
src += iff('naoRepetida', 'Não é repetida?', '{{ $json.send === true }}')
src += evo_http('enviar', 'Enviar no WhatsApp', 'POST',
                "={{ $('Config Evolution').first().json.base_url }}/message/sendText/{{ $('Config Evolution').first().json.instancia }}",
                "={{ JSON.stringify({ number: $('Recebe resposta para enviar').first().json.telefone, text: $('Dividir em mensagens').item.json.texto, delay: Math.min(6000, 1200 + $('Dividir em mensagens').item.json.texto.length * 35) }) }}")
src += rpc('guardar', 'Guardar id da mensagem', 'sdr_set_wa_id_by_msg',
           "={{ JSON.stringify({ p_message_id: $('Registrar e checar repetição').item.json.message_id, p_wa_message_id: $json.key?.id || '' }) }}",
           " onError: 'continueRegularOutput',")
src += "\nexport default workflow('lis-wa-enviar', 'LIS · WA Enviar')\n  .add(recebe).to(cfg).to(dividir).to(registrar).to(naoRepetida.onTrue(enviar.to(guardar)));\n"
write('lis-wa-enviar.ts', src)

# ------------------------------------------------------------------ LIS · Enviar fotos (ferramenta da Laura)
src = HEAD + CREDS
src += exec_trigger('recebe', 'Recebe pedido de fotos', ['lead_id', 'telefone', 'chave'])
src += rpc('cfg', 'Config Evolution', 'sdr_evo_config')
src += rpc('midias', 'Buscar fotos', 'lis_midias', "={{ JSON.stringify({ p_chave: $('Recebe pedido de fotos').first().json.chave }) }}")
src += code('separar', 'Separar fotos', r"""// o Supabase devolve uma lista; o n8n já transforma cada foto num item
return $input.all().map(i => i.json).filter(m => m && m.url).map(m => ({ json: m }));""")
src += rpc('registrar', 'Registrar envio', 'sdr_outbound',
           "={{ JSON.stringify({ p_lead_id: $('Recebe pedido de fotos').first().json.lead_id, p_content: '[' + ($json.tipo === 'video' ? 'vídeo' : 'foto') + ': ' + $('Recebe pedido de fotos').first().json.chave + '] ' + ($json.legenda || ''), p_sender: 'ia', p_type: $json.tipo || 'image' }) }}")
src += evo_http('enviar', 'Enviar mídia no WhatsApp', 'POST',
                "={{ $('Config Evolution').first().json.base_url }}/message/sendMedia/{{ $('Config Evolution').first().json.instancia }}",
                "={{ JSON.stringify({ number: $('Recebe pedido de fotos').first().json.telefone, mediatype: $('Separar fotos').item.json.tipo || 'image', media: $('Separar fotos').item.json.url, caption: $('Separar fotos').item.json.legenda || '', delay: 1500 }) }}")
src += rpc('guardar', 'Guardar id da mídia', 'sdr_set_wa_id_by_msg',
           "={{ JSON.stringify({ p_message_id: $('Registrar envio').item.json.message_id, p_wa_message_id: $json.key?.id || '' }) }}",
           " onError: 'continueRegularOutput',")
src += code('resposta', 'Resposta para a Laura', r"""const n = $input.all().length;
return [{ json: { ok: n > 0, enviadas: n, instrucao: n > 0 ? 'Fotos enviadas. Continue a conversa (ex.: pergunte qual técnica ela mais gostou). Não repita que enviou.' : 'Não há fotos cadastradas com essa chave. Siga sem fotos, descrevendo em texto.' } }];""", " executeOnce: true, alwaysOutputData: true,")
src += "\nexport default workflow('lis-enviar-fotos', 'LIS · Enviar fotos')\n  .add(recebe).to(cfg).to(midias).to(separar).to(registrar).to(enviar).to(guardar).to(resposta);\n"
write('lis-enviar-fotos.ts', src)

# ------------------------------------------------------------------ LIS · Transferir para a Lis
src = HEAD + CREDS
src += exec_trigger('recebe', 'Recebe transferência', ['lead_id', 'motivo', 'resumo'])
src += rpc('pausar', 'Pausar Laura e abrir transbordo', 'sdr_handoff',
           "={{ JSON.stringify({ p_lead_id: $json.lead_id, p_reason: $json.motivo || 'nao_sabe_responder', p_summary: $json.resumo || '' }) }}")
src += rpc('dados', 'Dados para o aviso', 'sdr_notify_payload',
           "={{ JSON.stringify({ p_lead_id: $('Recebe transferência').first().json.lead_id }) }}")
src += code('montar', 'Montar aviso', r"""const d = $input.first().json;
const nomes = { avaliacao_foto: 'precisa avaliar foto', micro_antiga: 'tem micropigmentação antiga de outra profissional', avaliacao_labios: 'micro labial: avaliar foto dos lábios',
  remocao_tatuagem: 'remoção de tatuagem: avaliar tamanho', reagendamento: 'quer remarcar/alterar horário', cancelamento: 'quer cancelar', comprovante: 'enviou comprovante/pagamento',
  cursos: 'interesse em cursos', saude: 'condição de saúde que precisa da Lis', pediu_humano: 'pediu para falar com a Lis', reclamacao: 'reclamação',
  negociacao: 'pediu desconto/condição especial', agenda_cheia: 'sem horário na agenda', nao_sabe_responder: 'a Laura não soube responder', erro: 'erro técnico no atendimento' };
const fone = String(d.telefone || '').replace(/^55/, '');
const texto = '⚠️ *Laura passou um atendimento para você*\n\n' +
  '*Cliente:* ' + (d.nome || '-') + ' (' + fone + ')\n' +
  (d.procedimento ? '*Interesse:* ' + d.procedimento + '\n' : '') +
  '*Motivo:* ' + (nomes[d.motivo] || d.motivo || '-') + '\n' +
  (d.resumo ? '*Resumo:* ' + d.resumo + '\n' : '') +
  '\nResponda a cliente pelo WhatsApp. Quando terminar, clique em *Devolver para a Laura* no CRM.';
const nums = (Array.isArray(d.numeros) ? d.numeros : []).map(n => String(n).replace(/\D/g, '')).filter(Boolean);
return nums.map(numero => ({ json: { numero, texto, base_url: d.base_url, instancia: d.instancia } }));""")
src += evo_http('avisar', 'Avisar a Lis no WhatsApp', 'POST', "={{ $json.base_url }}/message/sendText/{{ $json.instancia }}",
                "={{ JSON.stringify({ number: $json.numero, text: $json.texto }) }}", " onError: 'continueRegularOutput',")
src += code('resposta', 'Resposta para a Laura', "return [{ json: { ok: true, instrucao: 'Atendimento passado para a Lis. Se for caso de avaliação e você ainda não avisou, responda só uma mensagem curta dizendo que a Lis vai avaliar e já responde; nos outros casos responda exatamente NO_REPLY.' } }];",
            " executeOnce: true, alwaysOutputData: true,")
src += "\nexport default workflow('lis-transferir', 'LIS · Transferir para a Lis')\n  .add(recebe).to(pausar).to(dados).to(montar).to(avisar).to(resposta);\n"
write('lis-transferir.ts', src)

# ------------------------------------------------------------------ LIS · Agente Laura
L = "$('Carregar lote').item.json"
src = HEAD + CREDS
src += exec_trigger('recebe', 'Recebe mensagem da cliente', ['lead_id', 'message_id'])
src += rpc('lote', 'Carregar lote', 'sdr_batch', "={{ JSON.stringify({ p_lead_id: $json.lead_id, p_message_id: $json.message_id || null }) }}")
src += iff('processar', 'Laura deve responder?', '{{ $json.processar === true }}')
src += f"""const modelo = languageModel({{ type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', version: 1.3,
  config: {{ name: 'OpenAI', credentials: {{ openAiApi: newCredential('LIS OpenAI') }},
    parameters: {{ model: {{ __rl: true, mode: 'list', value: 'gpt-5-mini' }}, options: {{ reasoningEffort: 'low', timeout: 90000, maxRetries: 2 }} }} }} }});
"""
src += rpc_tool('tAtualizar', 'atualizar_cliente', 'sdr_update_lead',
  'Salva na ficha da cliente o que ela informou. Chame sempre que descobrir um dado novo (nome, aniversário, procedimento de interesse, respostas do questionário, saúde, preferência de turno).',
  "={{ JSON.stringify({ p_lead_id: " + L + ".lead_id, p_data: (() => { try { const v = $fromAI('dados', 'JSON só com os campos novos. Chaves: nome, aniversario (DD/MM), procedimento_interesse (código do catálogo), tecnica_interesse (microblading | shadow | shading_line), turno_preferido (manha | tarde), origem (indicacao | instagram | cliente_antiga | anuncio | google), primeira_vez (true/false), micro_anterior (texto), pele_oleosa (true/false), sobrancelha (texto: preenchida/falhas), estilo (natural | marcada | meio_termo), extensao_atual (true/false), saude (texto: gestante, lactante, diabetes, queloide, oncológico, cirurgia nos olhos...), stage (interessada | lista_laser_day | perdido), motivo_perda. Ex.: {\"nome\":\"Ana\",\"procedimento_interesse\":\"micro_sobrancelha\"}', 'string'); return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return {}; } })() }) }}")
src += rpc_tool('tHorarios', 'buscar_horarios', 'lis_horarios',
  'OBRIGATÓRIA antes de oferecer qualquer horário. Retorna horários livres reais da agenda da Lis para o(s) serviço(s). Se ok=false, siga a orientacao.',
  "={{ JSON.stringify({ p_lead_id: " + L + ".lead_id, p_servicos: $fromAI('servicos', 'Código(s) do catálogo separados por vírgula. Combo = vários códigos, ex.: cilios_fox_eyes,design_henna', 'string'), p_data: $fromAI('data', 'Data AAAA-MM-DD que a cliente pediu, ou vazio para os próximos dias', 'string') || null, p_turno: $fromAI('turno', 'manha, tarde ou vazio', 'string') || null }) }}")
src += rpc_tool('tAgendar', 'agendar', 'lis_agendar',
  'Marca o horário na agenda da Lis. Só chame depois que a cliente ESCOLHEU um horário oferecido e confirmou. Passe os mesmos códigos e o campo inicio exatamente como veio de buscar_horarios. Só confirme para a cliente se voltar ok=true; senão siga a orientacao.',
  "={{ JSON.stringify({ p_lead_id: " + L + ".lead_id, p_servicos: $fromAI('servicos', 'Os mesmos códigos usados em buscar_horarios', 'string'), p_inicio: $fromAI('inicio', 'Campo inicio exatamente como veio de buscar_horarios', 'string') }) }}")
src += tool_wf('tFotos', 'enviar_fotos', ID('enviar_fotos'),
  'Envia para a cliente fotos de trabalhos da Lis. Use só chaves que aparecem em FOTOS DISPONÍVEIS. Depois de chamar, não diga que vai mandar: já foi.',
  {'lead_id': '={{ ' + L + '.lead_id }}', 'telefone': '={{ ' + L + '.telefone }}',
   'chave': "={{ $fromAI('chave', 'Chave das fotos (uma das FOTOS DISPONÍVEIS)', 'string') }}"})
src += tool_wf('tTransferir', 'transferir_para_lis', ID('transferir'),
  'Pausa a Laura nesta conversa e avisa a Lis no WhatsApp. Depois de chamar, responda exatamente NO_REPLY. Motivos: avaliacao_foto, micro_antiga, avaliacao_labios, remocao_tatuagem, reagendamento, cancelamento, comprovante, cursos, saude, pediu_humano, reclamacao, negociacao, agenda_cheia, nao_sabe_responder.',
  {'lead_id': '={{ ' + L + '.lead_id }}', 'motivo': "={{ $fromAI('motivo', 'Um dos motivos da descrição', 'string') }}",
   'resumo': "={{ $fromAI('resumo', 'Resumo para a Lis em 2 ou 3 frases: quem é a cliente, o que quer e o que já foi conversado', 'string') }}"})
src += f"""const laura = node({{ type: '@n8n/n8n-nodes-langchain.agent', version: 3.1,
  config: {{ name: 'Laura', onError: 'continueErrorOutput',
    parameters: {{ promptType: 'define',
      text: expr({js("Histórico da conversa (mais antigo primeiro):\n{{ " + L + ".historico }}\n\nMensagens novas da cliente (leia todas juntas como um pedido só):\n{{ " + L + ".texto }}")}),
      options: {{ systemMessage: expr({js(PROMPT)}), maxIterations: 10 }} }},
    subnodes: {{ model: modelo, tools: [tAtualizar, tHorarios, tAgendar, tFotos, tTransferir] }} }} }});
"""
src += iff('temResposta', 'Tem resposta para enviar?', "{{ (() => { const t = String($json.output || '').trim(); return t.length > 0 && t.toUpperCase() !== 'NO_REPLY'; })() }}")
src += call_wf('enviarResp', 'Enviar resposta', ID('wa_enviar'),
  {'lead_id': '={{ ' + L + '.lead_id }}', 'telefone': '={{ ' + L + '.telefone }}', 'texto': "={{ String($('Laura').item.json.output || '').trim() }}"})
src += call_wf('erro', 'Erro: passar para a Lis', ID('transferir'),
  {'lead_id': '={{ ' + L + '.lead_id }}', 'motivo': 'erro', 'resumo': "={{ 'Falha técnica no atendimento automático. Última mensagem da cliente: ' + String(" + L + ".texto || '').slice(0, 300) }}"})
src += "\nexport default workflow('lis-agente-laura', 'LIS · Agente Laura')\n  .add(recebe).to(lote).to(processar.onTrue(laura))\n  .add(laura.output(0).to(temResposta.onTrue(enviarResp)))\n  .add(laura.output(1).to(erro));\n"
write('lis-agente-laura.ts', src)

# ------------------------------------------------------------------ helpers extras
def filtro(var, name, cond):
    return f"""const {var} = node({{ type: 'n8n-nodes-base.filter', version: 2.2, config: {{ name: {js(name)}, parameters: {{ conditions: {{
  options: {{ caseSensitive: true, leftValue: '', typeValidation: 'loose' }},
  conditions: [{{ leftValue: expr({js(cond)}), operator: {{ type: 'boolean', operation: 'true', singleValue: true }} }}],
  combinator: 'and' }} }} }} }});
"""

def respond(var, name, b, code_=None):
    opt = f", options: {{ responseCode: {code_} }}" if code_ else ", options: {}"
    return f"""const {var} = node({{ type: 'n8n-nodes-base.respondToWebhook', version: 1.1, config: {{ name: {js(name)},
  parameters: {{ respondWith: 'json', responseBody: {body(b)}{opt} }} }} }});
"""

def validar_login(var, name, webhook_node):
    # chama is_equipe() com o token do usuário logado no CRM: true só para e-mails cadastrados em public.equipe
    return f"""const {var} = node({{
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: {{ name: {js(name)},
    parameters: {{ method: 'POST', url: {js(SB + 'is_equipe')},
      sendHeaders: true, headerParameters: {{ parameters: [{{ name: 'apikey', value: {js(PUB)} }}, {{ name: 'Authorization', value: expr({js("{{ $('" + webhook_node + "').item.json.headers.authorization || '' }}")}) }}] }},
      sendBody: true, specifyBody: 'json', jsonBody: '{{}}',
      options: {{ timeout: 15000, response: {{ response: {{ neverError: true, responseFormat: 'text', outputPropertyName: 'data' }} }} }} }} }}
}});
"""

# ------------------------------------------------------------------ LIS · WA Entrada
N = "$('Normalizar mensagem').item.json"
src = HEAD + CREDS
src += f"""const webhook = trigger({{ type: 'n8n-nodes-base.webhook', version: 2.1,
  config: {{ name: 'Webhook Evolution', parameters: {{ httpMethod: 'POST', path: 'lis-wa-entrada-r8m3v6', options: {{ noResponseBody: true }} }} }} }});
"""
src += code('normalizar', 'Normalizar mensagem', r"""const out = [];
for (const it of $input.all()) {
  const b = it.json.body ?? it.json;
  const ev = String(b.event || '').toLowerCase().replace('_', '.');
  if (ev && ev !== 'messages.upsert') continue;
  const d = Array.isArray(b.data) ? b.data[0] : (b.data || {});
  const k = d.key || {};
  const jids = [k.remoteJid, k.remoteJidAlt, k.senderPn].filter(Boolean);
  if (jids.some(j => j.endsWith('@g.us') || j.endsWith('@broadcast') || j.endsWith('@newsletter'))) continue;
  const jid = jids.find(j => j.endsWith('@s.whatsapp.net'));
  if (!jid || !k.id) continue;
  const m = d.message || {};
  let tipo = 'outro', texto = null;
  if (m.conversation) { tipo = 'text'; texto = m.conversation; }
  else if (m.extendedTextMessage) { tipo = 'text'; texto = m.extendedTextMessage.text; }
  else if (m.imageMessage) { tipo = 'image'; texto = '[imagem]' + (m.imageMessage.caption ? ' ' + m.imageMessage.caption : ''); }
  else if (m.audioMessage) { tipo = 'audio'; }
  else if (m.videoMessage) { tipo = 'video'; texto = '[vídeo]' + (m.videoMessage.caption ? ' ' + m.videoMessage.caption : ''); }
  else if (m.documentMessage || m.documentWithCaptionMessage) { tipo = 'document'; const dm = m.documentMessage || m.documentWithCaptionMessage?.message?.documentMessage || {}; texto = '[documento] ' + (dm.fileName || '') + (dm.caption ? ' ' + dm.caption : ''); }
  else if (m.stickerMessage) { tipo = 'sticker'; texto = '[figurinha]'; }
  else if (m.locationMessage) { tipo = 'location'; texto = '[localização]'; }
  else if (m.contactMessage) { tipo = 'contact'; texto = '[contato] ' + (m.contactMessage.displayName || ''); }
  else if (m.reactionMessage || m.protocolMessage || m.editedMessage || m.senderKeyDistributionMessage) { continue; }
  else { texto = '[mensagem]'; }
  out.push({ json: { message_id: k.id, telefone: jid.split('@')[0], from_me: k.fromMe === true, tipo, texto, push_name: d.pushName || null, audio_base64: tipo === 'audio' ? (m.base64 || d.base64 || null) : null } });
}
return out;""")
src += iff('fromMe', 'Enviada pelo WhatsApp do studio?', '{{ $json.from_me === true }}')
src += rpc('equipe', 'Registrar mensagem da Lis', 'sdr_team_message',
           "={{ JSON.stringify({ p_phone: $json.telefone, p_content: $json.texto || ('[' + $json.tipo + ']'), p_type: $json.tipo, p_wa_message_id: $json.message_id }) }}")
src += rpc('entrada', 'Registrar entrada', 'sdr_inbound',
           "={{ JSON.stringify({ p_phone: $json.telefone, p_whatsapp_name: $json.push_name, p_content: $json.texto, p_type: $json.tipo, p_wa_message_id: $json.message_id }) }}")
src += iff('nova', 'Mensagem nova?', '{{ $json.duplicate === false && !!$json.message_id }}')
src += iff('audio', 'É áudio?', "{{ " + N + ".tipo === 'audio' }}")
src += rpc('cfgEvo', 'Config Evolution', 'sdr_evo_config')
src += evo_http('baixar', 'Buscar áudio na Evolution', 'POST', "={{ $json.base_url }}/chat/getBase64FromMediaMessage/{{ $json.instancia }}",
                "={{ JSON.stringify({ message: { key: { id: " + N + ".message_id } }, convertToMp4: false }) }}", " onError: 'continueRegularOutput',")
src += f"""const prep = node({{ type: 'n8n-nodes-base.set', version: 3.4, config: {{ name: 'Preparar áudio', parameters: {{ mode: 'manual', includeOtherFields: false,
  assignments: {{ assignments: [{{ id: 'a1', name: 'audio_base64', value: expr({js("{{ " + N + ".audio_base64 || $json.base64 || '' }}")}), type: 'string' }}] }} }} }} }});
const arquivo = node({{ type: 'n8n-nodes-base.convertToFile', version: 1.1, config: {{ name: 'Áudio em arquivo', onError: 'continueRegularOutput',
  parameters: {{ operation: 'toBinary', sourceProperty: 'audio_base64', options: {{ fileName: 'audio.ogg', mimeType: 'audio/ogg' }} }} }} }});
const transcrever = node({{ type: '@n8n/n8n-nodes-langchain.openAi', version: 2.3, config: {{ name: 'Transcrever áudio', onError: 'continueRegularOutput',
  credentials: {{ openAiApi: newCredential('LIS OpenAI') }}, parameters: {{ resource: 'audio', operation: 'transcribe', options: {{ language: 'pt' }} }} }} }});
"""
src += rpc('salvarTx', 'Salvar transcrição', 'sdr_set_content',
           "={{ JSON.stringify({ p_message_id: $('Registrar entrada').item.json.message_id, p_content: $json.text || '(não foi possível transcrever o áudio)' }) }}",
           " onError: 'continueRegularOutput',")
src += f"""const esperar = node({{ type: 'n8n-nodes-base.wait', version: 1.1, config: {{ name: 'Esperar a cliente terminar de digitar',
  parameters: {{ amount: expr("{{{{ $('Registrar entrada').item.json.janela_segundos || 15 }}}}") }} }} }});
"""
src += call_wf('chamarLaura', 'Chamar a Laura', ID('agente'),
  {'lead_id': "={{ $('Registrar entrada').item.json.lead_id }}", 'message_id': "={{ $('Registrar entrada').item.json.message_id }}"})
src += """
export default workflow('lis-wa-entrada', 'LIS · WA Entrada')
  .add(webhook).to(normalizar).to(fromMe.onTrue(equipe).onFalse(entrada.to(nova.onTrue(
     audio.onTrue(cfgEvo.to(baixar).to(prep).to(arquivo).to(transcrever).to(salvarTx).to(esperar))
          .onFalse(esperar)))))
  .add(esperar).to(chamarLaura);
"""
write('lis-wa-entrada.ts', src)

# ------------------------------------------------------------------ LIS · CRM Enviar
W = "$('CRM envia mensagem').item.json"
src = HEAD + CREDS
src += """const webhook = trigger({ type: 'n8n-nodes-base.webhook', version: 2.1,
  config: { name: 'CRM envia mensagem', parameters: { httpMethod: 'POST', path: 'lis-crm-enviar-w5k2p8', responseMode: 'responseNode', options: { allowedOrigins: '*' } } } });
"""
src += validar_login('login', 'Validar login do CRM', 'CRM envia mensagem')
src += iff('ok', 'Login válido e texto preenchido?', "{{ String($json.data).trim() === 'true' && String(" + W + ".body?.texto || '').trim().length > 0 && !!" + W + ".body?.lead_id }}")
src += rpc('registrar', 'Registrar mensagem da Lis', 'sdr_crm_message',
           "={{ JSON.stringify({ p_lead_id: " + W + ".body.lead_id, p_content: String(" + W + ".body.texto).trim(), p_user: 'crm' }) }}")
src += rpc('cfgEvo', 'Config Evolution', 'sdr_evo_config')
src += evo_http('enviar', 'Enviar no WhatsApp', 'POST', "={{ $json.base_url }}/message/sendText/{{ $json.instancia }}",
                "={{ JSON.stringify({ number: $('Registrar mensagem da Lis').item.json.telefone, text: String(" + W + ".body.texto).trim() }) }}")
src += rpc('guardar', 'Guardar id da mensagem', 'sdr_set_wa_id_by_msg',
           "={{ JSON.stringify({ p_message_id: $('Registrar mensagem da Lis').item.json.message_id, p_wa_message_id: $('Enviar no WhatsApp').item.json.key?.id || '' }) }}",
           " onError: 'continueRegularOutput',")
src += respond('resp', 'Responder ao CRM', "={{ JSON.stringify($('Enviar no WhatsApp').item.json.key?.id ? { ok: true } : { ok: false, error: 'A mensagem ficou registrada, mas o WhatsApp não confirmou o envio. Verifique a conexão em Configurações.' }) }}")
src += respond('negado', 'Responder: não autorizado', '{"ok":false,"error":"Sessão inválida ou mensagem vazia."}', 401)
src += """
export default workflow('lis-crm-enviar', 'LIS · CRM Enviar')
  .add(webhook).to(login).to(ok.onTrue(registrar.to(cfgEvo).to(enviar).to(guardar).to(resp)).onFalse(negado));
"""
write('lis-crm-enviar.ts', src)

# ------------------------------------------------------------------ LIS · WhatsApp Conexão
C = "$('Ler configuração').item.json"
A = "$('CRM pede ação no WhatsApp').item.json.body?.action"
src = HEAD + CREDS
src += """const webhook = trigger({ type: 'n8n-nodes-base.webhook', version: 2.1,
  config: { name: 'CRM pede ação no WhatsApp', parameters: { httpMethod: 'POST', path: 'lis-whatsapp-conexao-h4n9t2', responseMode: 'responseNode', options: { allowedOrigins: '*' } } } });
"""
src += validar_login('login', 'Validar login do CRM', 'CRM pede ação no WhatsApp')
src += iff('ok', 'Login válido?', "{{ String($json.data).trim() === 'true' }}")
src += rpc('cfg', 'Ler configuração', 'sdr_evo_config')
rules = []
for i, a in enumerate(['connect', 'logout', 'webhook']):
    rules.append(f"{{ outputKey: '{a}', conditions: {{ options: {{ caseSensitive: true, leftValue: '', typeValidation: 'loose' }}, conditions: [{{ leftValue: expr({js('{{ ' + A + ' }}')}), operator: {{ type: 'string', operation: 'equals' }}, rightValue: '{a}' }}], combinator: 'and' }} }}")
src += f"""const acao = switchCase({{ version: 3.2, config: {{ name: 'Qual ação?', parameters: {{ rules: {{ values: [{', '.join(rules)}] }},
  options: {{ fallbackOutput: 'extra', renameFallbackOutput: 'status' }} }} }} }});
"""
WH = "={{ JSON.stringify({ webhook: { enabled: true, url: " + C + ".webhook_atendimento, byEvents: false, base64: true, events: ['MESSAGES_UPSERT'] } }) }}"
src += evo_http('criar', 'Criar instância (se não existir)', 'POST', "={{ $json.base_url }}/instance/create",
                "={{ JSON.stringify({ instanceName: $json.instancia, integration: 'WHATSAPP-BAILEYS', qrcode: true, groupsIgnore: true }) }}")
src += evo_http('apontar', 'Apontar webhook para a Laura', 'POST', "={{ " + C + ".base_url }}/webhook/set/{{ " + C + ".instancia }}", WH)
src += evo_http('qr', 'Gerar QR Code', 'GET', "={{ " + C + ".base_url }}/instance/connect/{{ " + C + ".instancia }}")
src += respond('respQr', 'Responder com QR Code', "={{ JSON.stringify(($json.instance?.state === 'open') ? { connected: true } : (($json.base64 || $json.qrcode?.base64) ? { qr: $json.base64 || $json.qrcode?.base64, pairingCode: $json.pairingCode || null } : { error: $json.response?.message?.toString() || $json.message || 'A Evolution não devolveu o QR Code. Tente de novo em alguns segundos.' })) }}")
src += evo_http('sair', 'Desconectar número', 'DELETE', "={{ $json.base_url }}/instance/logout/{{ $json.instancia }}")
src += respond('respSair', 'Responder desconexão', "={{ JSON.stringify({ ok: !$json.error, detail: $json.error ? ($json.response?.message || $json.error) : null }) }}")
src += evo_http('webhookSet', 'Reconfigurar webhook', 'POST', "={{ $json.base_url }}/webhook/set/{{ $json.instancia }}", WH)
src += respond('respWh', 'Responder webhook', "={{ JSON.stringify({ ok: !$json.error, error: $json.error ? 'Não foi possível configurar o webhook.' : undefined }) }}")
src += evo_http('estado', 'Consultar conexão', 'GET', "={{ $json.base_url }}/instance/connectionState/{{ $json.instancia }}")
src += evo_http('dadosNum', 'Dados do número', 'GET', "={{ " + C + ".base_url }}/instance/fetchInstances?instanceName={{ " + C + ".instancia }}")
src += respond('respStatus', 'Responder status', "={{ (() => { const s = $('Consultar conexão').item.json; const i = Array.isArray($json) ? $json[0] : ($json.instance || $json); const notFound = s.status === 404 || String(s.response?.message || s.message || s.error || '').toLowerCase().includes('not'); const state = s.instance?.state || s.state || (notFound ? 'nao_criada' : 'close'); return JSON.stringify({ instance: " + C + ".instancia, webhook: " + C + ".webhook_atendimento, exists: state !== 'nao_criada', state, number: state === 'open' ? (String(i?.ownerJid || i?.owner || '').split('@')[0] || null) : null, profileName: state === 'open' ? (i?.profileName || null) : null }); })() }}")
src += respond('negado', 'Responder: sem acesso', '{"error":"Sessão inválida. Saia e entre de novo no CRM."}', 401)
src += """
export default workflow('lis-whatsapp-conexao', 'LIS · WhatsApp Conexão')
  .add(webhook).to(login).to(ok.onTrue(cfg.to(acao
      .onCase(0, criar.to(apontar).to(qr).to(respQr))
      .onCase(1, sair.to(respSair))
      .onCase(2, webhookSet.to(respWh))
      .onCase(3, estado.to(dadosNum).to(respStatus)))).onFalse(negado));
"""
write('lis-whatsapp-conexao.ts', src)

# ------------------------------------------------------------------ LIS · Rotinas (pendentes, follow-up, lembretes)
F = "$('Clientes para retomar').item.json"
src = HEAD + CREDS
src += """const agenda = trigger({ type: 'n8n-nodes-base.scheduleTrigger', version: 1.2,
  config: { name: 'A cada 10 minutos', parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 10 }] } } } });
"""
# A) mensagens sem resposta (fora do horário / devolvidas)
src += rpc('pend', 'Mensagens sem resposta', 'lis_pendentes')
src += filtro('temPend', 'Tem cliente?', '{{ !!$json.lead_id }}')
src += call_wf('laura', 'Laura responde', ID('agente'), {'lead_id': '={{ $json.lead_id }}', 'message_id': '={{ $json.message_id }}'})
# B) follow-up
src += rpc('fups', 'Clientes para retomar', 'sdr_followups_payload', extra=" executeOnce: true,")
src += filtro('temFup', 'Tem follow-up?', '{{ !!$json.lead_id }}')
src += f"""const modelo = languageModel({{ type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', version: 1.3,
  config: {{ name: 'OpenAI', credentials: {{ openAiApi: newCredential('LIS OpenAI') }},
    parameters: {{ model: {{ __rl: true, mode: 'list', value: 'gpt-5-mini' }}, options: {{ reasoningEffort: 'low', timeout: 60000, maxRetries: 2 }} }} }} }});
const escrever = node({{ type: '@n8n/n8n-nodes-langchain.agent', version: 3.1,
  config: {{ name: 'Escrever retomada', onError: 'continueRegularOutput',
    parameters: {{ promptType: 'define',
      text: expr({js("Cliente: {{ $json.nome || 'sem nome' }}\nProcedimento de interesse: {{ $json.procedimento || 'não informado' }}\nTentativa: {{ $json.tentativa }} de 4\nVai junto uma foto de trabalho da Lis: {{ $json.foto && $json.foto.url ? 'sim' : 'não' }}\n\nÚltimas mensagens:\n{{ $json.historico }}")}),
      options: {{ systemMessage: {js("Você é a Laura, assistente do Studio Lis Cazais (Salvador). A cliente parou de responder no WhatsApp. Escreva UMA mensagem curta (no máximo 2 frases) para retomar a conversa de onde parou. Tom: alegre, direto, sem pressão e sem excesso de carinho; trate por você. Nunca repita mensagem que já está no histórico. Nunca invente preço, desconto ou promoção. No máximo 1 emoji.\nTentativa 1 (dia seguinte): retome o último assunto ou pergunta de forma leve.\nTentativas 2 e 3: se for com foto, escreva uma frase curta que gere desejo pelo resultado do procedimento de interesse (vai como legenda da foto) e termine com uma pergunta simples; sem foto, relembre o benefício e pergunte se ela quer ver um horário.\nTentativa 4: despedida educada, dizendo que fica à disposição quando ela quiser.\nResponda SOMENTE com o texto da mensagem.")}, maxIterations: 2 }} }},
    subnodes: {{ model: modelo }} }} }});
"""
src += iff('comFoto', 'Vai com foto?', "{{ !!(" + F + ".foto && " + F + ".foto.url) && String($('Escrever retomada').item.json.output || '').trim().length > 0 }}")
src += rpc('logFoto', 'Registrar foto da retomada', 'sdr_outbound',
           "={{ JSON.stringify({ p_lead_id: " + F + ".lead_id, p_content: '[foto] ' + String($('Escrever retomada').item.json.output).trim(), p_sender: 'ia', p_type: 'image' }) }}")
src += rpc('cfgEvo', 'Config Evolution', 'sdr_evo_config', extra=" executeOnce: true,")
src += evo_http('mandaFoto', 'Enviar foto com legenda', 'POST', "={{ $('Config Evolution').first().json.base_url }}/message/sendMedia/{{ $('Config Evolution').first().json.instancia }}",
                "={{ JSON.stringify({ number: " + F + ".telefone, mediatype: " + F + ".foto.tipo || 'image', media: " + F + ".foto.url, caption: String($('Escrever retomada').item.json.output || '').trim() }) }}", " onError: 'continueRegularOutput',")
src += call_wf('mandaTexto', 'Enviar retomada', ID('wa_enviar'),
  {'lead_id': '={{ ' + F + '.lead_id }}', 'telefone': '={{ ' + F + '.telefone }}', 'texto': "={{ String($('Escrever retomada').item.json.output || '').trim() }}"}, wait=False, extra=" onError: 'continueRegularOutput',")
src += rpc('contar', 'Contar tentativa', 'sdr_mark_followup', "={{ JSON.stringify({ p_lead_id: " + F + ".lead_id }) }}")
# C) lembretes
src += rpc('lemb', 'Lembretes do dia', 'sdr_reminders_payload', extra=" executeOnce: true,")
src += filtro('temLemb', 'Tem lembrete?', '{{ !!$json.lead_id }}')
src += call_wf('mandaLemb', 'Enviar lembrete', ID('wa_enviar'),
  {'lead_id': "={{ $('Tem lembrete?').item.json.lead_id }}", 'telefone': "={{ $('Tem lembrete?').item.json.telefone }}", 'texto': "={{ $('Tem lembrete?').item.json.texto }}"}, wait=False, extra=" onError: 'continueRegularOutput',")
src += rpc('marcar', 'Marcar lembrete enviado', 'sdr_mark_reminder',
           "={{ JSON.stringify({ p_ref: $json.ref, p_tipo: $json.tipo }) }}")
src += """
export default workflow('lis-rotinas', 'LIS · Rotinas (retomadas e lembretes)')
  .add(agenda).to(pend).to(temPend).to(laura)
  .add(agenda).to(fups).to(temFup).to(escrever).to(contar).to(comFoto
      .onTrue(logFoto.to(cfgEvo).to(mandaFoto))
      .onFalse(mandaTexto))
  .add(agenda).to(lemb).to(temLemb).to(marcar).to(mandaLemb);
"""
write('lis-rotinas.ts', src)
