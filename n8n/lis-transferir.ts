import { workflow, node, trigger, ifElse, switchCase, languageModel, tool, expr, newCredential } from '@n8n/workflow-sdk';

const supa = { httpHeaderAuth: newCredential('LIS Supabase') };
const evo = { httpHeaderAuth: newCredential('LIS Evolution') };

const recebe = trigger({ type: 'n8n-nodes-base.executeWorkflowTrigger', version: 1.1,
  config: { name: "Recebe transferência", parameters: { workflowInputs: { values: [{ name: "lead_id" }, { name: "motivo" }, { name: "resumo" }] } } } });
const pausar = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Pausar Laura e abrir transbordo", credentials: supa,
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/sdr_handoff", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }] },
      sendBody: true, specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ p_lead_id: $json.lead_id, p_reason: $json.motivo || 'nao_sabe_responder', p_summary: $json.resumo || '' }) }}"), options: { timeout: 20000 } } }
});
const dados = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Dados para o aviso", credentials: supa,
    parameters: { method: 'POST', url: "https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/sdr_notify_payload", authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR" }] },
      sendBody: true, specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ p_lead_id: $('Recebe transferência').first().json.lead_id }) }}"), options: { timeout: 20000 } } }
});
const montar = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: "Montar aviso", parameters: { jsCode: "const d = $input.first().json;\nconst nomes = { avaliacao_foto: 'precisa avaliar foto', micro_antiga: 'tem micropigmentação antiga de outra profissional', avaliacao_labios: 'micro labial: avaliar foto dos lábios',\n  remocao_tatuagem: 'remoção de tatuagem: avaliar tamanho', reagendamento: 'quer remarcar/alterar horário', cancelamento: 'quer cancelar', comprovante: 'enviou comprovante/pagamento',\n  cursos: 'interesse em cursos', saude: 'condição de saúde que precisa da Lis', pediu_humano: 'pediu para falar com a Lis', reclamacao: 'reclamação',\n  negociacao: 'pediu desconto/condição especial', agenda_cheia: 'sem horário na agenda', nao_sabe_responder: 'a Laura não soube responder', erro: 'erro técnico no atendimento' };\nconst fone = String(d.telefone || '').replace(/^55/, '');\nconst texto = '⚠️ *Laura passou um atendimento para você*\\n\\n' +\n  '*Cliente:* ' + (d.nome || '-') + ' (' + fone + ')\\n' +\n  (d.procedimento ? '*Interesse:* ' + d.procedimento + '\\n' : '') +\n  '*Motivo:* ' + (nomes[d.motivo] || d.motivo || '-') + '\\n' +\n  (d.resumo ? '*Resumo:* ' + d.resumo + '\\n' : '') +\n  '\\nResponda a cliente pelo WhatsApp. Quando terminar, clique em *Devolver para a Laura* no CRM.';\nconst nums = (Array.isArray(d.numeros) ? d.numeros : []).map(n => String(n).replace(/\\D/g, '')).filter(Boolean);\nreturn nums.map(numero => ({ json: { numero, texto, base_url: d.base_url, instancia: d.instancia } }));" } } });
const avisar = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: { name: "Avisar a Lis no WhatsApp", onError: 'continueRegularOutput', credentials: evo,
    parameters: { method: "POST", url: expr("{{ $json.base_url }}/message/sendText/{{ $json.instancia }}"), authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ number: $json.numero, text: $json.texto }) }}"),
      options: { timeout: 30000, response: { response: { neverError: true } } } } }
});
const resposta = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: "Resposta para a Laura", executeOnce: true, alwaysOutputData: true, parameters: { jsCode: "return [{ json: { ok: true, instrucao: 'Atendimento passado para a Lis. Se for caso de avaliação e você ainda não avisou, responda só uma mensagem curta dizendo que a Lis vai avaliar e já responde; nos outros casos responda exatamente NO_REPLY.' } }];" } } });

export default workflow('lis-transferir', 'LIS · Transferir para a Lis')
  .add(recebe).to(pausar).to(dados).to(montar).to(avisar).to(resposta);
