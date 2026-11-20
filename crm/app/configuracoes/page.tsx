"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { supabase } from "@/lib/supabase";
import { fmtPhone } from "@/lib/labels";

type Status = {
  instance?: string; webhook?: string | null; exists?: boolean;
  state?: "open" | "close" | "connecting" | "nao_criada" | "erro"; number?: string | null; profileName?: string | null;
  error?: string;
};

// O CRM não guarda nenhuma chave secreta: ele chama um webhook do n8n (URL salva em config_bot),
// e o n8n fala com a Evolution usando a credencial dele. O n8n valida o login pelo token do Supabase.
async function api(method: "GET" | "POST", body?: object) {
  const [{ data: sess }, { data: cfg }] = await Promise.all([
    supabase.auth.getSession(),
    supabase.from("config_bot").select("valor").eq("chave", "n8n_webhook_whatsapp_url").maybeSingle(),
  ]);
  const url = (cfg?.valor as string) || "";
  if (!url) return { error: "Webhook do n8n ainda não configurado (n8n_webhook_whatsapp_url)." };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
      body: JSON.stringify(method === "GET" ? { action: "status" } : body),
    });
    if (res.status === 401) return { error: "Sessão inválida. Saia e entre de novo." };
    return await res.json();
  } catch {
    return { error: "Não foi possível falar com o n8n. Verifique se o workflow de conexão está ativo." };
  }
}

export default function ConfigPage() {
  return <Shell><Inner /></Shell>;
}

function Inner() {
  const [st, setSt] = useState<Status | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [pairing, setPairing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const qrTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const s: Status = await api("GET");
    setSt(s);
    if (s.state === "open") {
      setQr(null); setPairing(null);
      if (qrTimer.current) { clearInterval(qrTimer.current); qrTimer.current = null; }
    }
    return s;
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // enquanto o QR estiver na tela, verifica a conexão a cada 3 s
  useEffect(() => {
    if (!qr) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [qr, refresh]);

  useEffect(() => () => { if (qrTimer.current) clearInterval(qrTimer.current); }, []);

  async function genQr() {
    setBusy(true); setMsg("");
    const r = await api("POST", { action: "connect" });
    setBusy(false);
    if (r.error) { setMsg(r.error); return; }
    if (r.connected) { refresh(); return; }
    setQr(r.qr); setPairing(r.pairingCode);
    // o QR do WhatsApp expira em ~40 s: gera outro a cada 30 s
    if (qrTimer.current) clearInterval(qrTimer.current);
    qrTimer.current = setInterval(async () => {
      const n = await api("POST", { action: "connect" });
      if (n.connected) { refresh(); return; }
      if (n.qr) { setQr(n.qr); setPairing(n.pairingCode); }
    }, 30000);
    refresh();
  }

  async function logout() {
    if (!confirm("Desconectar o WhatsApp? A Laura para de atender até conectar de novo.")) return;
    setBusy(true);
    await api("POST", { action: "logout" });
    setBusy(false); setQr(null); refresh();
  }

  async function fixWebhook() {
    setBusy(true);
    const r = await api("POST", { action: "webhook" });
    setBusy(false);
    setMsg(r.ok ? "Webhook do agente configurado." : r.error ?? "Não foi possível configurar o webhook.");
  }

  const connected = st?.state === "open";

  return (
    <>
      <div className="page-head"><h1>Configurações</h1></div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3>WhatsApp do atendimento</h3>
          {!st ? <div className="muted">Verificando conexão…</div> : st.error ? (
            <div style={{ color: "var(--danger)" }}>{st.error}</div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span className="dot" style={{ background: connected ? "var(--c-green)" : st.state === "connecting" ? "var(--c-amber)" : "var(--c-red)", width: 10, height: 10 }} />
                <b>{connected ? "Conectado" : st.state === "connecting" ? "Aguardando leitura do QR Code" : "Desconectado"}</b>
              </div>

              {connected ? (
                <>
                  <dl className="fields" style={{ marginBottom: 16 }}>
                    <dt>Número</dt><dd>{st.number ? fmtPhone(st.number) : "—"}</dd>
                    <dt>Perfil</dt><dd>{st.profileName ?? "—"}</dd>
                    <dt>Instância</dt><dd>{st.instance}</dd>
                  </dl>
                  <p className="muted">A Laura está recebendo e respondendo as mensagens deste número.</p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="btn" disabled={busy} onClick={fixWebhook}>Reconfigurar webhook do agente</button>
                    <button className="btn danger" disabled={busy} onClick={logout}>Desconectar</button>
                  </div>
                </>
              ) : qr ? (
                <div style={{ textAlign: "center" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`} alt="QR Code do WhatsApp"
                       style={{ width: 260, height: 260, background: "#fff", padding: 8, borderRadius: 12 }} />
                  <ol style={{ textAlign: "left", maxWidth: 360, margin: "12px auto" }}>
                    <li>Abra o WhatsApp no celular do número de atendimento.</li>
                    <li>Toque em <b>Configurações → Aparelhos conectados → Conectar aparelho</b>.</li>
                    <li>Aponte a câmera para este QR Code.</li>
                  </ol>
                  {pairing && <p className="muted">Ou use o código de pareamento: <b>{pairing}</b></p>}
                  <p className="muted" style={{ fontSize: 12 }}>O QR Code é renovado automaticamente a cada 30 segundos.</p>
                </div>
              ) : (
                <>
                  <p className="muted">Conecte o WhatsApp do studio (71 99161-6280) para a Laura atender as clientes.</p>
                  <button className="btn primary" disabled={busy} onClick={genQr}>{busy ? "Gerando…" : "Gerar QR Code"}</button>
                </>
              )}
            </>
          )}
          {msg && <p style={{ marginTop: 12 }}>{msg}</p>}
        </div>

        <div className="card">
          <h3>Como funciona</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Depois de conectado, toda mensagem que chegar neste WhatsApp vai para a Laura, que atende das 8h às 20h, explica os procedimentos, passa valores e agenda. Fora desse horário ela responde no dia seguinte às 8h.
          </p>
          <p className="muted">
            Se você responder uma cliente pelo celular, a Laura pausa naquela conversa e volta sozinha depois de 3 horas sem mensagem sua (ou na hora, com “Devolver para a Laura”). Para testar antes de liberar para todas, preencha numeros_teste abaixo.
          </p>
          <p className="muted">Mantenha o celular com internet. Se o WhatsApp desconectar, gere um novo QR Code aqui.</p>
        </div>
      </div>
      <Fotos />
      <ConfigEditor />
    </>
  );
}

type Cfg = { chave: string; valor: unknown; descricao: string | null };

function ConfigEditor() {
  const [rows, setRows] = useState<Cfg[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState("");

  const load = useCallback(() => {
    supabase.from("config_bot").select("chave,valor,descricao").order("chave").then(({ data }) => {
      const r = (data as Cfg[]) ?? [];
      setRows(r);
      setDraft(Object.fromEntries(r.map((x) => [x.chave, typeof x.valor === "string" ? x.valor : JSON.stringify(x.valor)])));
    });
  }, []);
  useEffect(load, [load]);

  async function save(c: Cfg) {
    const raw = draft[c.chave];
    let valor: unknown = raw;
    if (typeof c.valor !== "string") {
      try { valor = JSON.parse(raw); } catch { setSaved(`Valor inválido em ${c.chave}`); return; }
    }
    const { error } = await supabase.from("config_bot").update({ valor }).eq("chave", c.chave);
    setSaved(error ? `Erro ao salvar ${c.chave}` : `${c.chave} salvo.`);
    load();
  }

  return (
    <div className="card">
      <h3>Parâmetros da Laura e do studio</h3>
      <div className="table-wrap">
        <table className="stack plain">
          <thead><tr><th>Parâmetro</th><th>Valor</th><th></th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.chave}>
                <td style={{ maxWidth: 320 }}><b>{c.chave}</b><div className="muted" style={{ fontSize: 12 }}>{c.descricao}</div></td>
                <td className="full" style={{ minWidth: 260 }}>
                  <input style={{ width: "100%" }} value={draft[c.chave] ?? ""} onChange={(e) => setDraft({ ...draft, [c.chave]: e.target.value })} />
                </td>
                <td className="actions"><button className="btn" onClick={() => save(c)}>Salvar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {saved && <p className="muted">{saved}</p>}
    </div>
  );
}

type Midia = { id: string; chave: string; url: string; tipo: string; legenda: string | null; ordem: number; ativo: boolean };
const CHAVES = [
  { k: "tecnicas_sobrancelha", l: "Técnicas de micro (Microblading, Shadow, Shading Line)" },
  { k: "sobrancelhas", l: "Trabalhos de sobrancelha" }, { k: "cilios", l: "Extensão de cílios" },
  { k: "labios", l: "Micropigmentação labial" }, { k: "laser", l: "Laser (antes e depois)" },
  { k: "depilacao", l: "Depilação" }, { k: "como_chegar", l: "Vídeo de como chegar ao studio" },
];

function Fotos() {
  const [items, setItems] = useState<Midia[]>([]);
  const [chave, setChave] = useState(CHAVES[0].k);
  const [legenda, setLegenda] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = useCallback(() => { supabase.from("midias").select("*").order("chave").order("ordem").then(({ data }) => setItems((data as Midia[]) ?? [])); }, []);
  useEffect(load, [load]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setMsg("");
    for (const f of Array.from(files)) {
      const path = `${chave}/${Date.now()}-${f.name.replace(/[^a-zA-Z0-9.]/g, "_")}`;
      const up = await supabase.storage.from("midias").upload(path, f, { contentType: f.type });
      if (up.error) { setMsg(up.error.message); continue; }
      const url = supabase.storage.from("midias").getPublicUrl(path).data.publicUrl;
      await supabase.from("midias").insert({ chave, url, tipo: f.type.startsWith("video") ? "video" : "image", legenda: legenda || null, ordem: items.filter((i) => i.chave === chave).length + 1 });
    }
    setBusy(false); setLegenda(""); load();
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3>Fotos e vídeos que a Laura envia</h3>
      <p className="muted" style={{ marginTop: 0 }}>A Laura manda até 4 fotos por assunto durante o atendimento (ex.: as 3 técnicas de micro) e usa as fotos no follow-up de quem parou de responder.</p>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <select value={chave} onChange={(e) => setChave(e.target.value)}>{CHAVES.map((c) => <option key={c.k} value={c.k}>{c.l}</option>)}</select>
        <input placeholder="Legenda (opcional)" value={legenda} onChange={(e) => setLegenda(e.target.value)} />
        <label className="btn primary">{busy ? "Enviando…" : "Escolher arquivos"}<input type="file" accept="image/*,video/*" multiple hidden disabled={busy} onChange={(e) => upload(e.target.files)} /></label>
      </div>
      {msg && <p style={{ color: "var(--danger)" }}>{msg}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10 }}>
        {items.map((m) => (
          <div key={m.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 6, fontSize: 12 }}>
            {m.tipo === "video" ? <video src={m.url} style={{ width: "100%", borderRadius: 6 }} /> : /* eslint-disable-next-line @next/next/no-img-element */ <img src={m.url} alt={m.legenda ?? m.chave} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 6 }} />}
            <div className="muted">{CHAVES.find((c) => c.k === m.chave)?.l ?? m.chave}</div>
            <button className="btn ghost sm danger" onClick={async () => { await supabase.from("midias").delete().eq("id", m.id); load(); }}>Remover</button>
          </div>
        ))}
      </div>
    </div>
  );
}
