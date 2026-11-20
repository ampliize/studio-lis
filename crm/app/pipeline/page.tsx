"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Clock, Hand, Search, Sparkles } from "lucide-react";
import Shell from "@/components/Shell";
import { Avatar, timeAgo } from "@/components/ui";
import { supabase, type Lead, type Stage } from "@/lib/supabase";
import { STAGES, displayName, label } from "@/lib/labels";

type Inbox = { id: string; ultima_msg: string | null; ultima_de: string | null; nao_lida: boolean };

const ATIVAS: Stage[] = ["novo", "em_atendimento", "interessada", "aguardando_sinal", "agendado", "atendida"];
const ENCERRADAS: Stage[] = ["lista_laser_day", "no_show", "perdido"];

export default function PipelinePage() {
  return <Shell><Pipeline /></Shell>;
}

function Pipeline() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [inbox, setInbox] = useState<Record<string, Inbox>>({});
  const [q, setQ] = useState("");
  const [quem, setQuem] = useState<"todos" | "ia" | "equipe">("todos");
  const [interesse, setInteresse] = useState("");
  const [servicos, setServicos] = useState<{ codigo: string; nome: string; categoria: string }[]>([]);
  const [encerrados, setEncerrados] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<Stage | null>(null);

  const load = useCallback(async () => {
    const [l, i, sv] = await Promise.all([
      supabase.from("leads").select("*").order("updated_at", { ascending: false }).limit(1000),
      supabase.rpc("crm_inbox", { p_filtro: "todas", p_busca: null }),
      supabase.from("servicos").select("codigo,nome,categoria").order("ordem"),
    ]);
    setServicos((sv.data as { codigo: string; nome: string; categoria: string }[]) ?? []);
    setLeads((l.data as Lead[]) ?? []);
    setInbox(Object.fromEntries(((i.data as Inbox[]) ?? []).map((x) => [x.id, x])));
  }, []);

  useEffect(() => {
    load();
    const ch = supabase.channel("pipeline")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, load)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return leads.filter((l) =>
      (!t || [l.name, l.whatsapp_name, l.phone].some((v) => v?.toLowerCase().includes(t))) &&
      (quem === "todos" || (quem === "equipe" ? l.ai_paused : !l.ai_paused)) &&
      (!interesse || servicos.find((x) => x.codigo === l.procedimento_interesse)?.categoria === interesse));
  }, [leads, q, quem, interesse, servicos]);

  const cols = encerrados ? [...ATIVAS, ...ENCERRADAS] : ATIVAS;
  const total = filtered.length || 1;

  async function move(id: string, stage: Stage) {
    const lead = leads.find((l) => l.id === id);
    if (!lead || lead.stage === stage) return;
    const patch: Partial<Lead> = { stage };
    if (stage === "perdido") {
      const r = window.prompt("Motivo da perda (ex.: preço, sem resposta, fez com outra profissional):", "");
      if (r === null) return;
      patch.lost_reason = r || "outro";
    }
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch, stage_changed_at: new Date().toISOString() } : l)));
    await supabase.from("leads").update(patch).eq("id", id);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Funil de clientes</h1>
          <p>Arraste os cards entre as etapas (no celular, use “Mover” no card). A Laura move as clientes sozinha até o agendamento.</p>
        </div>
        <div className="toolbar">
          <div className="search"><Search size={16} /><input placeholder="Buscar cliente ou telefone" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select value={interesse} onChange={(e) => setInteresse(e.target.value)}>
            <option value="">Todos os serviços</option>
            <option value="sobrancelhas">Sobrancelhas</option>
            <option value="cilios">Cílios</option>
            <option value="labios">Lábios</option>
            <option value="depilacao">Depilação</option>
            <option value="laser">Laser</option>
            <option value="cursos">Cursos</option>
          </select>
          <div className="seg">
            <button className={quem === "todos" ? "on" : ""} onClick={() => setQuem("todos")}>Todos</button>
            <button className={quem === "ia" ? "on" : ""} onClick={() => setQuem("ia")}>Com a Laura</button>
            <button className={quem === "equipe" ? "on" : ""} onClick={() => setQuem("equipe")}>Com a Lis</button>
          </div>
          <button className="btn" onClick={() => setEncerrados((v) => !v)}>{encerrados ? "Ocultar encerrados" : "Mostrar encerrados"}</button>
        </div>
      </div>

      <div className="pipeline">
        {cols.map((key) => {
          const st = STAGES.find((s) => s.key === key)!;
          const items = filtered.filter((l) => l.stage === key);
          return (
            <div
              key={key}
              className={`stage-col ${over === key ? "over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setOver(key); }}
              onDragLeave={() => setOver((o) => (o === key ? null : o))}
              onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData("text/plain"); if (id) move(id, key); }}
            >
              <div className="stage-head">
                <div className="t"><span className="dot" style={{ background: st.color }} />{st.label}<span className="n">{items.length}</span></div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{Math.round((items.length / total) * 100)}% das clientes</div>
                <div className="stage-bar" style={{ background: st.color, opacity: .7 }} />
              </div>
              <div className="stage-body">
                {items.length === 0 && <div className="muted" style={{ fontSize: 12, textAlign: "center", padding: 16 }}>Solte um card aqui</div>}
                {items.map((l) => {
                  const ib = inbox[l.id];
                  return (
                    <div
                      key={l.id}
                      role="link"
                      tabIndex={0}
                      onClick={() => router.push(`/leads/${l.id}`)}
                      onKeyDown={(e) => { if (e.key === "Enter") router.push(`/leads/${l.id}`); }}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", l.id); setDrag(l.id); }}
                      onDragEnd={() => setDrag(null)}
                      className={`deal ${drag === l.id ? "dragging" : ""}`}
                    >
                      <div className="h">
                        <Avatar name={displayName(l)} size="sm" />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="name">{displayName(l)}</div>
                          <div className="co">{servicos.find((x) => x.codigo === l.procedimento_interesse)?.nome ?? "Procedimento não informado"}</div>
                        </div>
                      </div>
                      {ib?.ultima_msg && <div className="snip">{ib.ultima_de === "lead" ? "" : ib.ultima_de === "ia" ? "Laura: " : "Lis: "}{ib.ultima_msg}</div>}
                      <div className="f">
                        {l.ai_paused ? <span className="badge amber"><Hand size={11} />Lis</span> : <span className="badge brand"><Bot size={11} />Laura</span>}
                        {l.turno_preferido && <span className="badge"><Sparkles size={11} />{label(l.turno_preferido)}</span>}
                        {ib?.nao_lida && <span className="badge ok">nova msg</span>}
                        <span className="sp"><Clock size={11} />{timeAgo(l.stage_changed_at)}</span>
                      </div>
                      <select
                        className="move-sm"
                        aria-label="Mover para outra etapa"
                        value={l.stage}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => move(l.id, e.target.value as Stage)}
                      >
                        {STAGES.map((s) => <option key={s.key} value={s.key}>Mover: {s.label}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
