import { workflow, node, trigger, ifElse, switchCase, languageModel, tool, expr, newCredential } from '@n8n/workflow-sdk';

const supa = { httpHeaderAuth: newCredential('LIS Supabase') };
const evo = { httpHeaderAuth: newCredential('LIS Evolution') };

const webhook = trigger({ type: 'n8n-nodes-base.webhook', version: 2.1,
  config: { name: 'CRM pede ação no WhatsApp', parameters: { httpMethod: 'POST', path: 'lis-whatsapp-conexao-h4n9t2', responseMode: 'responseNode', options: { allowedOrigins: '*' } } } });
const login = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Validar login do CRM",
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/is_equipe",
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }, { name: 'Authorization', value: expr("{{ $('CRM pede ação no WhatsApp').item.json.headers.authorization || '' }}") }] },
      sendBody: true, specifyBody: 'json', jsonBody: '{}',
      options: { timeout: 15000, response: { response: { neverError: true, responseFormat: 'text', outputPropertyName: 'data' } } } } }
});
const ok = ifElse({ version: 2.2, config: { name: "Login válido?", parameters: { conditions: {
  options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
  conditions: [{ leftValue: expr("{{ String($json.data).trim() === 'true' }}"), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
  combinator: 'and' } } } });
const cfg = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Ler configuração", credentials: supa,
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/sdr_evo_config", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }] },
      sendBody: true, specifyBody: 'json', jsonBody: "{}", options: { timeout: 20000 } } }
});
const acao = switchCase({ version: 3.2, config: { name: 'Qual ação?', parameters: { rules: { values: [{ outputKey: 'connect', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ leftValue: expr("{{ $('CRM pede ação no WhatsApp').item.json.body?.action }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'connect' }], combinator: 'and' } }, { outputKey: 'logout', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ leftValue: expr("{{ $('CRM pede ação no WhatsApp').item.json.body?.action }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'logout' }], combinator: 'and' } }, { outputKey: 'webhook', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ leftValue: expr("{{ $('CRM pede ação no WhatsApp').item.json.body?.action }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'webhook' }], combinator: 'and' } }] },
  options: { fallbackOutput: 'extra', renameFallbackOutput: 'status' } } } });
const criar = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Criar instância (se não existir)", credentials: evo,
    parameters: { method: "POST", url: expr("{{ $json.base_url }}/instance/create"), authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ instanceName: $json.instancia, integration: 'WHATSAPP-BAILEYS', qrcode: true, groupsIgnore: true }) }}"),
      options: { timeout: 30000, response: { response: { neverError: true } } } } }
});
const apontar = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Apontar webhook para a Laura", credentials: evo,
    parameters: { method: "POST", url: expr("{{ $('Ler configuração').item.json.base_url }}/webhook/set/{{ $('Ler configuração').item.json.instancia }}"), authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ webhook: { enabled: true, url: $('Ler configuração').item.json.webhook_atendimento, byEvents: false, base64: true, events: ['MESSAGES_UPSERT'] } }) }}"),
      options: { timeout: 30000, response: { response: { neverError: true } } } } }
});
const qr = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Gerar QR Code", credentials: evo,
    parameters: { method: "GET", url: expr("{{ $('Ler configuração').item.json.base_url }}/instance/connect/{{ $('Ler configuração').item.json.instancia }}"), authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      options: { timeout: 30000, response: { response: { neverError: true } } } } }
});
const respQr = node({ type: 'n8n-nodes-base.respondToWebhook', version: 1.1, config: { name: "Responder com QR Code",
  parameters: { respondWith: 'json', responseBody: expr("{{ JSON.stringify(($json.instance?.state === 'open') ? { connected: true } : (($json.base64 || $json.qrcode?.base64) ? { qr: $json.base64 || $json.qrcode?.base64, pairingCode: $json.pairingCode || null } : { error: $json.response?.message?.toString() || $json.message || 'A Evolution não devolveu o QR Code. Tente de novo em alguns segundos.' })) }}"), options: {} } } });
const sair = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Desconectar número", credentials: evo,
    parameters: { method: "DELETE", url: expr("{{ $json.base_url }}/instance/logout/{{ $json.instancia }}"), authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      options: { timeout: 30000, response: { response: { neverError: true } } } } }
});
const respSair = node({ type: 'n8n-nodes-base.respondToWebhook', version: 1.1, config: { name: "Responder desconexão",
  parameters: { respondWith: 'json', responseBody: expr("{{ JSON.stringify({ ok: !$json.error, detail: $json.error ? ($json.response?.message || $json.error) : null }) }}"), options: {} } } });
const webhookSet = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Reconfigurar webhook", credentials: evo,
    parameters: { method: "POST", url: expr("{{ $json.base_url }}/webhook/set/{{ $json.instancia }}"), authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ webhook: { enabled: true, url: $('Ler configuração').item.json.webhook_atendimento, byEvents: false, base64: true, events: ['MESSAGES_UPSERT'] } }) }}"),
      options: { timeout: 30000, response: { response: { neverError: true } } } } }
});
const respWh = node({ type: 'n8n-nodes-base.respondToWebhook', version: 1.1, config: { name: "Responder webhook",
  parameters: { respondWith: 'json', responseBody: expr("{{ JSON.stringify({ ok: !$json.error, error: $json.error ? 'Não foi possível configurar o webhook.' : undefined }) }}"), options: {} } } });
const estado = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Consultar conexão", credentials: evo,
    parameters: { method: "GET", url: expr("{{ $json.base_url }}/instance/connectionState/{{ $json.instancia }}"), authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      options: { timeout: 30000, response: { response: { neverError: true } } } } }
});
const dadosNum = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Dados do número", credentials: evo,
    parameters: { method: "GET", url: expr("{{ $('Ler configuração').item.json.base_url }}/instance/fetchInstances?instanceName={{ $('Ler configuração').item.json.instancia }}"), authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      options: { timeout: 30000, response: { response: { neverError: true } } } } }
});
const respStatus = node({ type: 'n8n-nodes-base.respondToWebhook', version: 1.1, config: { name: "Responder status",
  parameters: { respondWith: 'json', responseBody: expr("{{ (() => { const s = $('Consultar conexão').item.json; const i = Array.isArray($json) ? $json[0] : ($json.instance || $json); const notFound = s.status === 404 || String(s.response?.message || s.message || s.error || '').toLowerCase().includes('not'); const state = s.instance?.state || s.state || (notFound ? 'nao_criada' : 'close'); return JSON.stringify({ instance: $('Ler configuração').item.json.instancia, webhook: $('Ler configuração').item.json.webhook_atendimento, exists: state !== 'nao_criada', state, number: state === 'open' ? (String(i?.ownerJid || i?.owner || '').split('@')[0] || null) : null, profileName: state === 'open' ? (i?.profileName || null) : null }); })() }}"), options: {} } } });
const negado = node({ type: 'n8n-nodes-base.respondToWebhook', version: 1.1, config: { name: "Responder: sem acesso",
  parameters: { respondWith: 'json', responseBody: "{\"error\":\"Sessão inválida. Saia e entre de novo no CRM.\"}", options: { responseCode: 401 } } } });

export default workflow('lis-whatsapp-conexao', 'LIS · WhatsApp Conexão')
  .add(webhook).to(login).to(ok.onTrue(cfg.to(acao
      .onCase(0, criar.to(apontar).to(qr).to(respQr))
      .onCase(1, sair.to(respSair))
      .onCase(2, webhookSet.to(respWh))
      .onCase(3, estado.to(dadosNum).to(respStatus)))).onFalse(negado));
