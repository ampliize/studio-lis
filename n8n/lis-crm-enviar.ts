import { workflow, node, trigger, ifElse, switchCase, languageModel, tool, expr, newCredential } from '@n8n/workflow-sdk';

const supa = { httpHeaderAuth: newCredential('LIS Supabase') };
const evo = { httpHeaderAuth: newCredential('LIS Evolution') };

const webhook = trigger({ type: 'n8n-nodes-base.webhook', version: 2.1,
  config: { name: 'CRM envia mensagem', parameters: { httpMethod: 'POST', path: 'lis-crm-enviar-w5k2p8', responseMode: 'responseNode', options: { allowedOrigins: '*' } } } });
const login = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Validar login do CRM",
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/is_equipe",
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }, { name: 'Authorization', value: expr("{{ $('CRM envia mensagem').item.json.headers.authorization || '' }}") }] },
      sendBody: true, specifyBody: 'json', jsonBody: '{}',
      options: { timeout: 15000, response: { response: { neverError: true, responseFormat: 'text', outputPropertyName: 'data' } } } } }
});
const ok = ifElse({ version: 2.2, config: { name: "Login válido e texto preenchido?", parameters: { conditions: {
  options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
  conditions: [{ leftValue: expr("{{ String($json.data).trim() === 'true' && String($('CRM envia mensagem').item.json.body?.texto || '').trim().length > 0 && !!$('CRM envia mensagem').item.json.body?.lead_id }}"), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
  combinator: 'and' } } } });
const registrar = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Registrar mensagem da Lis", credentials: supa,
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/sdr_crm_message", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }] },
      sendBody: true, specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ p_lead_id: $('CRM envia mensagem').item.json.body.lead_id, p_content: String($('CRM envia mensagem').item.json.body.texto).trim(), p_user: 'crm' }) }}"), options: { timeout: 20000 } } }
});
const cfgEvo = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Config Evolution", credentials: supa,
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/sdr_evo_config", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }] },
      sendBody: true, specifyBody: 'json', jsonBody: "{}", options: { timeout: 20000 } } }
});
const enviar = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Enviar no WhatsApp", credentials: evo,
    parameters: { method: "POST", url: expr("{{ $json.base_url }}/message/sendText/{{ $json.instancia }}"), authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ number: $('Registrar mensagem da Lis').item.json.telefone, text: String($('CRM envia mensagem').item.json.body.texto).trim() }) }}"),
      options: { timeout: 30000, response: { response: { neverError: true } } } } }
});
const guardar = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Guardar id da mensagem", onError: 'continueRegularOutput', credentials: supa,
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/sdr_set_wa_id_by_msg", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }] },
      sendBody: true, specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ p_message_id: $('Registrar mensagem da Lis').item.json.message_id, p_wa_message_id: $('Enviar no WhatsApp').item.json.key?.id || '' }) }}"), options: { timeout: 20000 } } }
});
const resp = node({ type: 'n8n-nodes-base.respondToWebhook', version: 1.1, config: { name: "Responder ao CRM",
  parameters: { respondWith: 'json', responseBody: expr("{{ JSON.stringify($('Enviar no WhatsApp').item.json.key?.id ? { ok: true } : { ok: false, error: 'A mensagem ficou registrada, mas o WhatsApp não confirmou o envio. Verifique a conexão em Configurações.' }) }}"), options: {} } } });
const negado = node({ type: 'n8n-nodes-base.respondToWebhook', version: 1.1, config: { name: "Responder: não autorizado",
  parameters: { respondWith: 'json', responseBody: "{\"ok\":false,\"error\":\"Sessão inválida ou mensagem vazia.\"}", options: { responseCode: 401 } } } });

export default workflow('lis-crm-enviar', 'LIS · CRM Enviar')
  .add(webhook).to(login).to(ok.onTrue(registrar.to(cfgEvo).to(enviar).to(guardar).to(resp)).onFalse(negado));
