import { workflow, node, trigger, ifElse, switchCase, languageModel, tool, expr, newCredential } from '@n8n/workflow-sdk';

const supa = { httpHeaderAuth: newCredential('LIS Supabase') };
const evo = { httpHeaderAuth: newCredential('LIS Evolution') };

const webhook = trigger({ type: 'n8n-nodes-base.webhook', version: 2.1,
  config: { name: 'Webhook Evolution', parameters: { httpMethod: 'POST', path: 'lis-wa-entrada-r8m3v6', options: { noResponseBody: true } } } });
const normalizar = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: "Normalizar mensagem", parameters: { jsCode: "const out = [];\nfor (const it of $input.all()) {\n  const b = it.json.body ?? it.json;\n  const ev = String(b.event || '').toLowerCase().replace('_', '.');\n  if (ev && ev !== 'messages.upsert') continue;\n  const d = Array.isArray(b.data) ? b.data[0] : (b.data || {});\n  const k = d.key || {};\n  const jids = [k.remoteJid, k.remoteJidAlt, k.senderPn].filter(Boolean);\n  if (jids.some(j => j.endsWith('@g.us') || j.endsWith('@broadcast') || j.endsWith('@newsletter'))) continue;\n  const jid = jids.find(j => j.endsWith('@s.whatsapp.net'));\n  if (!jid || !k.id) continue;\n  const m = d.message || {};\n  let tipo = 'outro', texto = null;\n  if (m.conversation) { tipo = 'text'; texto = m.conversation; }\n  else if (m.extendedTextMessage) { tipo = 'text'; texto = m.extendedTextMessage.text; }\n  else if (m.imageMessage) { tipo = 'image'; texto = '[imagem]' + (m.imageMessage.caption ? ' ' + m.imageMessage.caption : ''); }\n  else if (m.audioMessage) { tipo = 'audio'; }\n  else if (m.videoMessage) { tipo = 'video'; texto = '[vídeo]' + (m.videoMessage.caption ? ' ' + m.videoMessage.caption : ''); }\n  else if (m.documentMessage || m.documentWithCaptionMessage) { tipo = 'document'; const dm = m.documentMessage || m.documentWithCaptionMessage?.message?.documentMessage || {}; texto = '[documento] ' + (dm.fileName || '') + (dm.caption ? ' ' + dm.caption : ''); }\n  else if (m.stickerMessage) { tipo = 'sticker'; texto = '[figurinha]'; }\n  else if (m.locationMessage) { tipo = 'location'; texto = '[localização]'; }\n  else if (m.contactMessage) { tipo = 'contact'; texto = '[contato] ' + (m.contactMessage.displayName || ''); }\n  else if (m.reactionMessage || m.protocolMessage || m.editedMessage || m.senderKeyDistributionMessage) { continue; }\n  else { texto = '[mensagem]'; }\n  out.push({ json: { message_id: k.id, telefone: jid.split('@')[0], from_me: k.fromMe === true, tipo, texto, push_name: d.pushName || null, audio_base64: tipo === 'audio' ? (m.base64 || d.base64 || null) : null } });\n}\nreturn out;" } } });
const fromMe = ifElse({ version: 2.2, config: { name: "Enviada pelo WhatsApp do studio?", parameters: { conditions: {
  options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
  conditions: [{ leftValue: expr("{{ $json.from_me === true }}"), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
  combinator: 'and' } } } });
const equipe = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Registrar mensagem da Lis", credentials: supa,
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/sdr_team_message", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }] },
      sendBody: true, specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ p_phone: $json.telefone, p_content: $json.texto || ('[' + $json.tipo + ']'), p_type: $json.tipo, p_wa_message_id: $json.message_id }) }}"), options: { timeout: 20000 } } }
});
const entrada = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Registrar entrada", credentials: supa,
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/sdr_inbound", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }] },
      sendBody: true, specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ p_phone: $json.telefone, p_whatsapp_name: $json.push_name, p_content: $json.texto, p_type: $json.tipo, p_wa_message_id: $json.message_id }) }}"), options: { timeout: 20000 } } }
});
const nova = ifElse({ version: 2.2, config: { name: "Mensagem nova?", parameters: { conditions: {
  options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
  conditions: [{ leftValue: expr("{{ $json.duplicate === false && !!$json.message_id }}"), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
  combinator: 'and' } } } });
const audio = ifElse({ version: 2.2, config: { name: "É áudio?", parameters: { conditions: {
  options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
  conditions: [{ leftValue: expr("{{ $('Normalizar mensagem').item.json.tipo === 'audio' }}"), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
  combinator: 'and' } } } });
const cfgEvo = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Config Evolution", credentials: supa,
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/sdr_evo_config", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }] },
      sendBody: true, specifyBody: 'json', jsonBody: "{}", options: { timeout: 20000 } } }
});
const baixar = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Buscar áudio na Evolution", onError: 'continueRegularOutput', credentials: evo,
    parameters: { method: "POST", url: expr("{{ $json.base_url }}/chat/getBase64FromMediaMessage/{{ $json.instancia }}"), authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ message: { key: { id: $('Normalizar mensagem').item.json.message_id } }, convertToMp4: false }) }}"),
      options: { timeout: 30000, response: { response: { neverError: true } } } } }
});
const prep = node({ type: 'n8n-nodes-base.set', version: 3.4, config: { name: 'Preparar áudio', parameters: { mode: 'manual', includeOtherFields: false,
  assignments: { assignments: [{ id: 'a1', name: 'audio_base64', value: expr("{{ $('Normalizar mensagem').item.json.audio_base64 || $json.base64 || '' }}"), type: 'string' }] } } } });
const arquivo = node({ type: 'n8n-nodes-base.convertToFile', version: 1.1, config: { name: 'Áudio em arquivo', onError: 'continueRegularOutput',
  parameters: { operation: 'toBinary', sourceProperty: 'audio_base64', options: { fileName: 'audio.ogg', mimeType: 'audio/ogg' } } } });
const transcrever = node({ type: '@n8n/n8n-nodes-langchain.openAi', version: 2.3, config: { name: 'Transcrever áudio', onError: 'continueRegularOutput',
  credentials: { openAiApi: newCredential('LIS OpenAI') }, parameters: { resource: 'audio', operation: 'transcribe', options: { language: 'pt' } } } });
const salvarTx = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Salvar transcrição", onError: 'continueRegularOutput', credentials: supa,
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/sdr_set_content", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }] },
      sendBody: true, specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ p_message_id: $('Registrar entrada').item.json.message_id, p_content: $json.text || '(não foi possível transcrever o áudio)' }) }}"), options: { timeout: 20000 } } }
});
const esperar = node({ type: 'n8n-nodes-base.wait', version: 1.1, config: { name: 'Esperar a cliente terminar de digitar',
  parameters: { amount: expr("{{ $('Registrar entrada').item.json.janela_segundos || 15 }}") } } });
const chamarLaura = node({ type: 'n8n-nodes-base.executeWorkflow', version: 1.3,
  config: { name: "Chamar a Laura", parameters: { workflowId: { __rl: true, mode: 'id', value: "1B0FFGEGR47jhFye" },
    workflowInputs: { mappingMode: 'defineBelow', value: { "lead_id": expr("{{ $('Registrar entrada').item.json.lead_id }}"), "message_id": expr("{{ $('Registrar entrada').item.json.message_id }}") }, matchingColumns: [], schema: [{ id: "lead_id", displayName: "lead_id", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }, { id: "message_id", displayName: "message_id", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }] },
    options: { waitForSubWorkflow: false } } } });

export default workflow('lis-wa-entrada', 'LIS · WA Entrada')
  .add(webhook).to(normalizar).to(fromMe.onTrue(equipe).onFalse(entrada.to(nova.onTrue(
     audio.onTrue(cfgEvo.to(baixar).to(prep).to(arquivo).to(transcrever).to(salvarTx).to(esperar))
          .onFalse(esperar)))))
  .add(esperar).to(chamarLaura);
