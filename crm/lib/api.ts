import { supabase } from "./supabase";

async function cfg(chave: string): Promise<string> {
  const { data } = await supabase.from("config_bot").select("valor").eq("chave", chave).maybeSingle();
  return (data?.valor as string) || "";
}

/** Chama um webhook do n8n com o token do usuário logado (o n8n valida o login). */
export async function callN8n<T = Record<string, unknown>>(chave: string, body: object): Promise<T & { error?: string }> {
  const [{ data: sess }, url] = await Promise.all([supabase.auth.getSession(), cfg(chave)]);
  if (!url) return { error: `Webhook do n8n não configurado (${chave}).` } as T & { error?: string };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
      body: JSON.stringify(body),
    });
    if (res.status === 401) return { error: "Sessão inválida. Saia e entre de novo." } as T & { error?: string };
    return (await res.json()) as T & { error?: string };
  } catch {
    return { error: "Não foi possível falar com o n8n. Verifique se o workflow está ativo." } as T & { error?: string };
  }
}

export function sendTeamMessage(leadId: string, texto: string) {
  return callN8n<{ ok?: boolean }>("n8n_webhook_crm_enviar_url", { lead_id: leadId, texto });
}

export async function markSeen(leadId: string) {
  await supabase.from("leads").update({ team_seen_at: new Date().toISOString() }).eq("id", leadId);
}

export async function myEmail() {
  const { data } = await supabase.auth.getUser();
  return data.user?.email ?? "equipe";
}

export async function returnToAi(leadId: string) {
  await supabase.rpc("sdr_return_to_ai", { p_lead_id: leadId, p_by: await myEmail() });
}

export async function takeOver(leadId: string) {
  await supabase.rpc("crm_assumir", { p_lead_id: leadId });
}
