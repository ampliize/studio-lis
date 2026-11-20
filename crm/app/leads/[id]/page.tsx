"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, MessageCircle, MessagesSquare } from "lucide-react";
import Shell from "@/components/Shell";
import { AiStrip, Composer, Messages } from "@/components/Chat";
import { Avatar, StageBadge, timeAgo } from "@/components/ui";
import { supabase, type Agendamento, type Handoff, type Lead, type LeadEvent, type Message, type Stage } from "@/lib/supabase";
import { FichaCliente, ListaAgendamentos } from "@/components/Ficha";
import { STAGES, displayName, fmtDateTime, fmtDuration, fmtPhone, label, stageLabel } from "@/lib/labels";
import { markSeen } from "@/lib/api";

export default function LeadPage() {
  return <Shell><LeadInner /></Shell>;
}

function LeadInner() {
  const { id } = useParams<{ id: string }>();
  const [lead, setLead] = useState<Lead | null>(null);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [ags, setAgs] = useState<Agendamento[]>([]);
  const [servico, setServico] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    const [l, m, e, h, mt] = await Promise.all([
      supabase.from("leads").select("*").eq("id", id).single(),
      supabase.from("messages").select("*").eq("lead_id", id).order("created_at"),
      supabase.from("lead_events").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
      supabase.from("handoffs").select("*").eq("lead_id", id).eq("status", "aberto").maybeSingle(),
      supabase.from("agendamentos").select("*").eq("lead_id", id).order("inicio", { ascending: false }),
    ]);
    setLead(l.data as Lead);
    setNotes((l.data as Lead)?.notes ?? "");
    setMsgs((m.data as Message[]) ?? []);
    setEvents((e.data as LeadEvent[]) ?? []);
    setHandoff((h.data as Handoff) ?? null);
    setAgs((mt.data as Agendamento[]) ?? []);
    const cod = (l.data as Lead)?.procedimento_interesse;
    if (cod) { const { data: sv } = await supabase.from("servicos").select("nome").eq("codigo", cod).maybeSingle(); setServico((sv?.nome as string) ?? null); }
  }, [id]);

  useEffect(() => {
    load(); markSeen(id);
    const ch = supabase.channel(`lead-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `lead_id=eq.${id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter: `id=eq.${id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "handoffs", filter: `lead_id=eq.${id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "agendamentos", filter: `lead_id=eq.${id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, load]);

  async function changeStage(stage: Stage) {
    await supabase.from("leads").update({ stage }).eq("id", id);
    load();
  }

  if (!lead) return <div className="muted">Carregando…</div>;

  const firstResp = lead.first_message_at && lead.first_response_at
    ? (new Date(lead.first_response_at).getTime() - new Date(lead.first_message_at).getTime()) / 1000 : null;

  return (
    <>
      <Link href="/leads" className="muted row" style={{ marginBottom: 12, fontSize: 13 }}><ArrowLeft size={14} />Clientes</Link>
      <div className="page-head">
        <div className="row" style={{ gap: 14 }}>
          <Avatar name={displayName(lead)} />
          <div>
            <h1>{displayName(lead)}</h1>
            <p>{fmtPhone(lead.phone)}{servico ? ` · ${servico}` : ""}</p>
          </div>
        </div>
        <div className="toolbar">
          <StageBadge stage={lead.stage} />
          <select value={lead.stage} onChange={(e) => changeStage(e.target.value as Stage)}>
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <Link className="btn" href={`/conversas?lead=${lead.id}`}><MessagesSquare size={15} /><span className="hide-sm">Abrir em </span>Conversas</Link>
          <a className="btn" href={`https://wa.me/${lead.phone}`} target="_blank" rel="noreferrer"><MessageCircle size={15} />WhatsApp</a>
        </div>
      </div>

      <div className="grid three">
        <div className="card p0 chat-card">
          <AiStrip lead={lead} reason={handoff?.reason} onChange={load} />
          {handoff?.summary && lead.ai_paused && <div style={{ padding: "8px 16px", fontSize: 13, borderBottom: "1px solid var(--border)" }}><b>Resumo da Laura:</b> {handoff.summary}</div>}
          <div style={{ background: "var(--panel-2)", flex: 1, minHeight: 0, display: "flex" }}><Messages msgs={msgs} /></div>
          <Composer lead={lead} onSent={load} />
        </div>

        <div className="grid" style={{ alignContent: "start" }}>
          <div className="card">
            <h3>Ficha da cliente</h3>
            <FichaCliente lead={lead} servicoNome={servico} />
            {lead.lost_reason && <div className="muted" style={{ marginTop: 8 }}>Perdida: {label(lead.lost_reason)}</div>}
          </div>

          <div className="card">
            <h3>Horários</h3>
            <ListaAgendamentos items={ags} />
          </div>

          <div className="card">
            <h3>Indicadores</h3>
            <dl className="fields">
              <dt>1º contato</dt><dd>{fmtDateTime(lead.first_message_at)}</dd>
              <dt>1ª resposta em</dt><dd>{fmtDuration(firstResp)}</dd>
                            <dt>Agendado em</dt><dd>{fmtDateTime(lead.scheduled_at)}</dd>
              <dt>Na etapa há</dt><dd>{timeAgo(lead.stage_changed_at)}</dd>
              <dt>Mensagens</dt><dd>{msgs.filter((m) => m.direction === "in").length} recebidas · {msgs.filter((m) => m.sender === "ia").length} Laura · {msgs.filter((m) => m.sender === "equipe").length} Lis</dd>
              <dt>Follow-ups</dt><dd>{lead.followup_count}</dd>
            </dl>
          </div>

          <div className="card">
            <h3>Jornada</h3>
            <ul className="timeline">
              {events.map((e) => (
                <li key={e.id}>
                  <div>{e.type === "etapa" ? <>{stageLabel(e.from_stage)} → <b>{stageLabel(e.to_stage)}</b></> : <b>{label(e.type)}</b>}
                    {e.type === "ia_pausada" && e.data?.reason ? <span className="muted"> · {label(String(e.data.reason))}</span> : null}
                    {e.actor === "equipe" && <span className="muted"> · pela Lis</span>}
                  </div>
                  <div className="when">{fmtDateTime(e.created_at)}</div>
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h3>Anotações da Lis</h3>
            <textarea rows={4} style={{ width: "100%" }} value={notes} onChange={(e) => setNotes(e.target.value)}
              onBlur={() => supabase.from("leads").update({ notes }).eq("id", id)} placeholder="Anotações internas (salvam ao sair do campo)" />
          </div>
        </div>
      </div>
    </>
  );
}
