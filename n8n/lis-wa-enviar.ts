import { workflow, node, trigger, ifElse, switchCase, languageModel, tool, expr, newCredential } from '@n8n/workflow-sdk';

const supa = { httpHeaderAuth: newCredential('LIS Supabase') };
const evo = { httpHeaderAuth: newCredential('LIS Evolution') };

const recebe = trigger({ type: 'n8n-nodes-base.executeWorkflowTrigger', version: 1.1,
  config: { name: "Recebe resposta para enviar", parameters: { workflowInputs: { values: [{ name: "lead_id" }, { name: "telefone" }, { name: "texto" }] } } } });
const cfg = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Config Evolution", credentials: supa,
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/sdr_evo_config", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }] },
      sendBody: true, specifyBody: 'json', jsonBody: "{}", options: { timeout: 20000 } } }
});
const dividir = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: "Dividir em mensagens", parameters: { jsCode: "const t = String($('Recebe resposta para enviar').first().json.texto || '').trim();\nif (!t || t.toUpperCase() === 'NO_REPLY') return [];\nconst partes = t.split(/\\n\\s*---\\s*\\n|^\\s*---\\s*$/m).map(s => s.trim()).filter(s => s && s.toUpperCase() !== 'NO_REPLY').slice(0, 3);\nreturn partes.map((texto, i) => ({ json: { texto, ordem: i } }));" } } });
const registrar = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Registrar e checar repetição", credentials: supa,
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/sdr_outbound", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }] },
      sendBody: true, specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ p_lead_id: $('Recebe resposta para enviar').first().json.lead_id, p_content: $json.texto, p_sender: 'ia' }) }}"), options: { timeout: 20000 } } }
});
const naoRepetida = ifElse({ version: 2.2, config: { name: "Não é repetida?", parameters: { conditions: {
  options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
  conditions: [{ leftValue: expr("{{ $json.send === true }}"), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
  combinator: 'and' } } } });
const enviar = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Enviar no WhatsApp", credentials: evo,
    parameters: { method: "POST", url: expr("{{ $('Config Evolution').first().json.base_url }}/message/sendText/{{ $('Config Evolution').first().json.instancia }}"), authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ number: $('Recebe resposta para enviar').first().json.telefone, text: $('Dividir em mensagens').item.json.texto, delay: Math.min(6000, 1200 + $('Dividir em mensagens').item.json.texto.length * 35) }) }}"),
      options: { timeout: 30000, response: { response: { neverError: true } } } } }
});
const guardar = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Guardar id da mensagem", onError: 'continueRegularOutput', credentials: supa,
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/sdr_set_wa_id_by_msg", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }] },
      sendBody: true, specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ p_message_id: $('Registrar e checar repetição').item.json.message_id, p_wa_message_id: $json.key?.id || '' }) }}"), options: { timeout: 20000 } } }
});

export default workflow('lis-wa-enviar', 'LIS · WA Enviar')
  .add(recebe).to(cfg).to(dividir).to(registrar).to(naoRepetida.onTrue(enviar.to(guardar)));
