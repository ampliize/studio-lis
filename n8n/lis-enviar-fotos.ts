import { workflow, node, trigger, ifElse, switchCase, languageModel, tool, expr, newCredential } from '@n8n/workflow-sdk';

const supa = { httpHeaderAuth: newCredential('LIS Supabase') };
const evo = { httpHeaderAuth: newCredential('LIS Evolution') };

const recebe = trigger({ type: 'n8n-nodes-base.executeWorkflowTrigger', version: 1.1,
  config: { name: "Recebe pedido de fotos", parameters: { workflowInputs: { values: [{ name: "lead_id" }, { name: "telefone" }, { name: "chave" }] } } } });
const cfg = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Config Evolution", credentials: supa,
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/sdr_evo_config", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }] },
      sendBody: true, specifyBody: 'json', jsonBody: "{}", options: { timeout: 20000 } } }
});
const midias = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Buscar fotos", credentials: supa,
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/lis_midias", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }] },
      sendBody: true, specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ p_chave: $('Recebe pedido de fotos').first().json.chave }) }}"), options: { timeout: 20000 } } }
});
const separar = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: "Separar fotos", parameters: { jsCode: "// o Supabase devolve uma lista; o n8n já transforma cada foto num item\nreturn $input.all().map(i => i.json).filter(m => m && m.url).map(m => ({ json: m }));" } } });
const registrar = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Registrar envio", credentials: supa,
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/sdr_outbound", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }] },
      sendBody: true, specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ p_lead_id: $('Recebe pedido de fotos').first().json.lead_id, p_content: '[' + ($json.tipo === 'video' ? 'vídeo' : 'foto') + ': ' + $('Recebe pedido de fotos').first().json.chave + '] ' + ($json.legenda || ''), p_sender: 'ia', p_type: $json.tipo || 'image' }) }}"), options: { timeout: 20000 } } }
});
const enviar = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Enviar mídia no WhatsApp", credentials: evo,
    parameters: { method: "POST", url: expr("{{ $('Config Evolution').first().json.base_url }}/message/sendMedia/{{ $('Config Evolution').first().json.instancia }}"), authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ number: $('Recebe pedido de fotos').first().json.telefone, mediatype: $('Separar fotos').item.json.tipo || 'image', media: $('Separar fotos').item.json.url, caption: $('Separar fotos').item.json.legenda || '', delay: 1500 }) }}"),
      options: { timeout: 30000, response: { response: { neverError: true } } } } }
});
const guardar = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Guardar id da mídia", onError: 'continueRegularOutput', credentials: supa,
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/sdr_set_wa_id_by_msg", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }] },
      sendBody: true, specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ p_message_id: $('Registrar envio').item.json.message_id, p_wa_message_id: $json.key?.id || '' }) }}"), options: { timeout: 20000 } } }
});
const resposta = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: "Resposta para a Laura", executeOnce: true, alwaysOutputData: true, parameters: { jsCode: "const n = $input.all().length;\nreturn [{ json: { ok: n > 0, enviadas: n, instrucao: n > 0 ? 'Fotos enviadas. Continue a conversa (ex.: pergunte qual técnica ela mais gostou). Não repita que enviou.' : 'Não há fotos cadastradas com essa chave. Siga sem fotos, descrevendo em texto.' } }];" } } });

export default workflow('lis-enviar-fotos', 'LIS · Enviar fotos')
  .add(recebe).to(cfg).to(midias).to(separar).to(registrar).to(enviar).to(guardar).to(resposta);
