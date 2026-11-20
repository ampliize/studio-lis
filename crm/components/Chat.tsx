"use client";
import { Bot, Hand, Send, UserRound } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import type { Lead, Message } from "@/lib/supabase";
import { returnToAi, sendTeamMessage, takeOver } from "@/lib/api";
import { label } from "@/lib/labels";
import { hhmm } from "./ui";

function dayLabel(d: string) {
  const dt = new Date(d);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (dt.toDateString() === today.toDateString()) return "Hoje";
  if (dt.toDateString() === y.toDateString()) return "Ontem";
  return dt.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
}

export function Messages({ msgs, boxed }: { msgs: Message[]; boxed?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [msgs.length]);
  let lastDay = "";
  return (
    <div className={`chat ${boxed ? "boxed" : ""}`} ref={ref}>
      {msgs.length === 0 && <div className="muted" style={{ margin: "auto" }}>Sem mensagens ainda.</div>}
      {msgs.map((m) => {
        const d = new Date(m.created_at).toDateString();
        const showDay = d !== lastDay; lastDay = d;
        return (
          <Fragment key={m.id}>
            {showDay && <div className="day">{dayLabel(m.created_at)}</div>}
            <div className={`bubble ${m.direction} ${m.sender}`}>
              {m.type === "audio" && <div className="muted" style={{ fontSize: 12, marginBottom: 2 }}>🎤 Áudio transcrito</div>}
              {m.content ?? `[${m.type}]`}
              <div className="meta">
                {m.sender === "ia" && <><Bot size={12} />Laura (IA)</>}
                {m.sender === "equipe" && <><UserRound size={12} />Lis</>}
                <span>{hhmm(m.created_at)}</span>
              </div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

export function AiStrip({ lead, reason, onChange }: { lead: Lead; reason?: string | null; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  if (lead.ai_paused) {
    return (
      <div className="ai-strip off">
        <Hand size={16} />
        <span><b>Lis atendendo.</b> A Laura está pausada nesta conversa{reason ? ` · ${label(reason)}` : ""}.</span>
        <button className="btn sm primary" disabled={busy} onClick={async () => { setBusy(true); await returnToAi(lead.id); setBusy(false); onChange(); }}>
          <Bot size={14} />Devolver para a Laura
        </button>
      </div>
    );
  }
  return (
    <div className="ai-strip on">
      <Bot size={16} />
      <span><b>Laura atendendo.</b> Se você enviar uma mensagem, a Laura pausa nesta conversa.</span>
      <button className="btn sm" disabled={busy} onClick={async () => { setBusy(true); await takeOver(lead.id); setBusy(false); onChange(); }}>
        <Hand size={14} />Assumir
      </button>
    </div>
  );
}

export function Composer({ lead, onSent }: { lead: Lead; onSent: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true); setErr("");
    const r = await sendTeamMessage(lead.id, t);
    setBusy(false);
    if (r.error) { setErr(r.error); if (!String(r.error).includes("registrada")) return; }
    setText(""); onSent();
  }

  return (
    <div className="composer">
      <div className="bar">
        <textarea
          rows={2}
          placeholder="Escreva uma mensagem…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button className="btn primary" disabled={busy || !text.trim()} onClick={send}><Send size={15} />{busy ? "Enviando…" : "Enviar"}</button>
      </div>
      {err ? <div className="hint" style={{ color: "var(--danger)" }}>{err}</div>
        : <div className="hint">Enter envia, Shift+Enter quebra linha. A mensagem sai pelo WhatsApp do atendimento.{!lead.ai_paused && " Ao enviar, a Laura pausa nesta conversa até você devolver."}</div>}
    </div>
  );
}
