import { workflow, node, trigger, ifElse, switchCase, languageModel, tool, expr, newCredential } from '@n8n/workflow-sdk';

const supa = { httpHeaderAuth: newCredential('LIS Supabase') };
const evo = { httpHeaderAuth: newCredential('LIS Evolution') };

const agenda = trigger({ type: 'n8n-nodes-base.scheduleTrigger', version: 1.2,
  config: { name: 'A cada 10 minutos', parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 10 }] } } } });
const pend = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Mensagens sem resposta", credentials: supa,
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/lis_pendentes", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }] },
      sendBody: true, specifyBody: 'json', jsonBody: "{}", options: { timeout: 20000 } } }
});
const temPend = node({ type: 'n8n-nodes-base.filter', version: 2.2, config: { name: "Tem cliente?", parameters: { conditions: {
  options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
  conditions: [{ leftValue: expr("{{ !!$json.lead_id }}"), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
  combinator: 'and' } } } });
const laura = node({ type: 'n8n-nodes-base.executeWorkflow', version: 1.3,
  config: { name: "Laura responde", parameters: { workflowId: { __rl: true, mode: 'id', value: "1B0FFGEGR47jhFye" },
    workflowInputs: { mappingMode: 'defineBelow', value: { "lead_id": expr("{{ $json.lead_id }}"), "message_id": expr("{{ $json.message_id }}") }, matchingColumns: [], schema: [{ id: "lead_id", displayName: "lead_id", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }, { id: "message_id", displayName: "message_id", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }] },
    options: { waitForSubWorkflow: false } } } });
const fups = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Clientes para retomar", executeOnce: true, credentials: supa,
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/sdr_followups_payload", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }] },
      sendBody: true, specifyBody: 'json', jsonBody: "{}", options: { timeout: 20000 } } }
});
const temFup = node({ type: 'n8n-nodes-base.filter', version: 2.2, config: { name: "Tem follow-up?", parameters: { conditions: {
  options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
  conditions: [{ leftValue: expr("{{ !!$json.lead_id }}"), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
  combinator: 'and' } } } });
const modelo = languageModel({ type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', version: 1.3,
  config: { name: 'OpenAI', credentials: { openAiApi: newCredential('LIS OpenAI') },
    parameters: { model: { __rl: true, mode: 'list', value: 'gpt-5-mini' }, options: { reasoningEffort: 'low', timeout: 60000, maxRetries: 2 } } } });
const escrever = node({ type: '@n8n/n8n-nodes-langchain.agent', version: 3.1,
  config: { name: 'Escrever retomada', onError: 'continueRegularOutput',
    parameters: { promptType: 'define',
      text: expr("Cliente: {{ $json.nome || 'sem nome' }}\nProcedimento de interesse: {{ $json.procedimento || 'não informado' }}\nTentativa: {{ $json.tentativa }} de 4\nVai junto uma foto de trabalho da Lis: {{ $json.foto && $json.foto.url ? 'sim' : 'não' }}\n\nÚltimas mensagens:\n{{ $json.historico }}"),
      options: { systemMessage: "Você é a Laura, assistente do Studio Lis Cazais (Salvador). A cliente parou de responder no WhatsApp. Escreva UMA mensagem curta (no máximo 2 frases) para retomar a conversa de onde parou. Tom: alegre, direto, sem pressão e sem excesso de carinho; trate por você. Nunca repita mensagem que já está no histórico. Nunca invente preço, desconto ou promoção. No máximo 1 emoji.\nTentativa 1 (dia seguinte): retome o último assunto ou pergunta de forma leve.\nTentativas 2 e 3: se for com foto, escreva uma frase curta que gere desejo pelo resultado do procedimento de interesse (vai como legenda da foto) e termine com uma pergunta simples; sem foto, relembre o benefício e pergunte se ela quer ver um horário.\nTentativa 4: despedida educada, dizendo que fica à disposição quando ela quiser.\nResponda SOMENTE com o texto da mensagem.", maxIterations: 2 } },
    subnodes: { model: modelo } } });
const comFoto = ifElse({ version: 2.2, config: { name: "Vai com foto?", parameters: { conditions: {
  options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
  conditions: [{ leftValue: expr("{{ !!($('Clientes para retomar').item.json.foto && $('Clientes para retomar').item.json.foto.url) && String($('Escrever retomada').item.json.output || '').trim().length > 0 }}"), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
  combinator: 'and' } } } });
const logFoto = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Registrar foto da retomada", credentials: supa,
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/sdr_outbound", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }] },
      sendBody: true, specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ p_lead_id: $('Clientes para retomar').item.json.lead_id, p_content: '[foto] ' + String($('Escrever retomada').item.json.output).trim(), p_sender: 'ia', p_type: 'image' }) }}"), options: { timeout: 20000 } } }
});
const cfgEvo = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Config Evolution", executeOnce: true, credentials: supa,
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/sdr_evo_config", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }] },
      sendBody: true, specifyBody: 'json', jsonBody: "{}", options: { timeout: 20000 } } }
});
const mandaFoto = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Enviar foto com legenda", onError: 'continueRegularOutput', credentials: evo,
    parameters: { method: "POST", url: expr("{{ $('Config Evolution').first().json.base_url }}/message/sendMedia/{{ $('Config Evolution').first().json.instancia }}"), authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ number: $('Clientes para retomar').item.json.telefone, mediatype: $('Clientes para retomar').item.json.foto.tipo || 'image', media: $('Clientes para retomar').item.json.foto.url, caption: String($('Escrever retomada').item.json.output || '').trim() }) }}"),
      options: { timeout: 30000, response: { response: { neverError: true } } } } }
});
const mandaTexto = node({ type: 'n8n-nodes-base.executeWorkflow', version: 1.3,
  config: { name: "Enviar retomada", onError: 'continueRegularOutput', parameters: { workflowId: { __rl: true, mode: 'id', value: "T3okYMyx0BKK9DoV" },
    workflowInputs: { mappingMode: 'defineBelow', value: { "lead_id": expr("{{ $('Clientes para retomar').item.json.lead_id }}"), "telefone": expr("{{ $('Clientes para retomar').item.json.telefone }}"), "texto": expr("{{ String($('Escrever retomada').item.json.output || '').trim() }}") }, matchingColumns: [], schema: [{ id: "lead_id", displayName: "lead_id", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }, { id: "telefone", displayName: "telefone", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }, { id: "texto", displayName: "texto", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }] },
    options: { waitForSubWorkflow: false } } } });
const contar = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Contar tentativa", credentials: supa,
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/sdr_mark_followup", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }] },
      sendBody: true, specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ p_lead_id: $('Clientes para retomar').item.json.lead_id }) }}"), options: { timeout: 20000 } } }
});
const lemb = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Lembretes do dia", executeOnce: true, credentials: supa,
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/sdr_reminders_payload", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }] },
      sendBody: true, specifyBody: 'json', jsonBody: "{}", options: { timeout: 20000 } } }
});
const temLemb = node({ type: 'n8n-nodes-base.filter', version: 2.2, config: { name: "Tem lembrete?", parameters: { conditions: {
  options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
  conditions: [{ leftValue: expr("{{ !!$json.lead_id }}"), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
  combinator: 'and' } } } });
const mandaLemb = node({ type: 'n8n-nodes-base.executeWorkflow', version: 1.3,
  config: { name: "Enviar lembrete", onError: 'continueRegularOutput', parameters: { workflowId: { __rl: true, mode: 'id', value: "T3okYMyx0BKK9DoV" },
    workflowInputs: { mappingMode: 'defineBelow', value: { "lead_id": expr("{{ $('Tem lembrete?').item.json.lead_id }}"), "telefone": expr("{{ $('Tem lembrete?').item.json.telefone }}"), "texto": expr("{{ $('Tem lembrete?').item.json.texto }}") }, matchingColumns: [], schema: [{ id: "lead_id", displayName: "lead_id", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }, { id: "telefone", displayName: "telefone", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }, { id: "texto", displayName: "texto", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }] },
    options: { waitForSubWorkflow: false } } } });
const marcar = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Marcar lembrete enviado", credentials: supa,
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/sdr_mark_reminder", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }] },
      sendBody: true, specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ p_ref: $json.ref, p_tipo: $json.tipo }) }}"), options: { timeout: 20000 } } }
});

export default workflow('lis-rotinas', 'LIS · Rotinas (retomadas e lembretes)')
  .add(agenda).to(pend).to(temPend).to(laura)
  .add(agenda).to(fups).to(temFup).to(escrever).to(contar).to(comFoto
      .onTrue(logFoto.to(cfgEvo).to(mandaFoto))
      .onFalse(mandaTexto))
  .add(agenda).to(lemb).to(temLemb).to(marcar).to(mandaLemb);
