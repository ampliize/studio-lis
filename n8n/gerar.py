"""Gera o código (n8n Workflow SDK) dos workflows LIS a partir de definições compactas.
Uso:  python3 gerar.py   →  escreve n8n/*.ts
Sem segredos: credenciais "LIS Supabase" (header x-lis-token) e "LIS Evolution" (header apikey) ficam no n8n.
"""
import json, pathlib

SB = 'https://neeffqfzbvxqxfwoftbl.supabase.co/rest/v1/rpc/'
PUB = 'sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR'
OUT = pathlib.Path(__file__).parent
HEAD = "import { workflow, node, trigger, ifElse, switchCase, languageModel, tool, expr, newCredential } from '@n8n/workflow-sdk';\n\n"
CREDS = "const supa = { httpHeaderAuth: newCredential('LIS Supabase') };\nconst evo = { httpHeaderAuth: newCredential('LIS Evolution') };\n\n"


def js(v):
    return json.dumps(v, ensure_ascii=False)


def body(b):
    """b começando com '=' vira expr(); senão literal."""
    if b.startswith('='):
        return f"expr({js(b[1:])})"
    return js(b)


def rpc(var, name, fn, b='{}', extra=''):
    return f"""const {var} = node({{
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: {{ name: {js(name)},{extra} credentials: supa,
    parameters: {{ method: 'POST', url: {js(SB + fn)}, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: {{ parameters: [{{ name: 'apikey', value: {js(PUB)} }}] }},
      sendBody: true, specifyBody: 'json', jsonBody: {body(b)}, options: {{ timeout: 20000 }} }} }}
}});
"""


def rpc_tool(var, name, fn, desc, b):
    return f"""const {var} = tool({{
  type: 'n8n-nodes-base.httpRequestTool', version: 4.2,
  config: {{ name: {js(name)}, credentials: supa,
    parameters: {{ toolDescription: {js(desc)}, method: 'POST', url: {js(SB + fn)},
      authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: {{ parameters: [{{ name: 'apikey', value: {js(PUB)} }}] }},
      sendBody: true, specifyBody: 'json', jsonBody: {body(b)}, options: {{ timeout: 20000 }} }} }}
}});
"""


def evo_http(var, name, method, url, b=None, extra=''):
    bb = f" sendBody: true, specifyBody: 'json', jsonBody: {body(b)}," if b else ''
    return f"""const {var} = node({{
  type: 'n8n-nodes-base.httpRequest', version: 4.2,
  config: {{ name: {js(name)},{extra} credentials: evo,
    parameters: {{ method: {js(method)}, url: {body(url)}, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',{bb}
      options: {{ timeout: 30000, response: {{ response: {{ neverError: true }} }} }} }} }}
}});
"""


def iff(var, name, cond):
    return f"""const {var} = ifElse({{ version: 2.2, config: {{ name: {js(name)}, parameters: {{ conditions: {{
  options: {{ caseSensitive: true, leftValue: '', typeValidation: 'loose' }},
  conditions: [{{ leftValue: expr({js(cond)}), operator: {{ type: 'boolean', operation: 'true', singleValue: true }} }}],
  combinator: 'and' }} }} }} }});
"""


def code(var, name, src, extra=''):
    return f"""const {var} = node({{ type: 'n8n-nodes-base.code', version: 2, config: {{ name: {js(name)},{extra} parameters: {{ jsCode: {js(src)} }} }} }});
"""


def exec_trigger(var, name, inputs):
    vals = ', '.join(f"{{ name: {js(i)} }}" for i in inputs)
    return f"""const {var} = trigger({{ type: 'n8n-nodes-base.executeWorkflowTrigger', version: 1.1,
  config: {{ name: {js(name)}, parameters: {{ workflowInputs: {{ values: [{vals}] }} }} }} }});
"""


def call_wf(var, name, wf_id, inputs: dict, wait=False, extra=''):
    vals = ', '.join(f"{js(k)}: {body(v) if v.startswith('=') else js(v)}" for k, v in inputs.items())
    schema = ', '.join(f"{{ id: {js(k)}, displayName: {js(k)}, required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }}" for k in inputs)
    return f"""const {var} = node({{ type: 'n8n-nodes-base.executeWorkflow', version: 1.3,
  config: {{ name: {js(name)},{extra} parameters: {{ workflowId: {{ __rl: true, mode: 'id', value: {js(wf_id)} }},
    workflowInputs: {{ mappingMode: 'defineBelow', value: {{ {vals} }}, matchingColumns: [], schema: [{schema}] }},
    options: {{ waitForSubWorkflow: {str(wait).lower()} }} }} }} }});
"""


def tool_wf(var, name, wf_id, desc, inputs: dict):
    vals = ', '.join(f"{js(k)}: {body(v) if v.startswith('=') else js(v)}" for k, v in inputs.items())
    schema = ', '.join(f"{{ id: {js(k)}, displayName: {js(k)}, required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }}" for k in inputs)
    return f"""const {var} = tool({{ type: '@n8n/n8n-nodes-langchain.toolWorkflow', version: 2.2,
  config: {{ name: {js(name)}, parameters: {{ description: {js(desc)}, workflowId: {{ __rl: true, mode: 'id', value: {js(wf_id)} }},
    workflowInputs: {{ mappingMode: 'defineBelow', value: {{ {vals} }}, matchingColumns: [], schema: [{schema}] }} }} }} }});
"""


def write(fname, src):
    (OUT / fname).write_text(src)
    print('ok', fname, len(src))
