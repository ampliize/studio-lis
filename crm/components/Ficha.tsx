"use client";
import { Fragment } from "react";
import type { Agendamento, Lead } from "@/lib/supabase";
import { AG_STATUS, brl, fmtDate, fmtDateTime, fmtWhen, label } from "@/lib/labels";
import { timeAgo } from "./ui";

const FICHA_LABELS: Record<string, string> = {
  primeira_vez: "Primeira vez", micro_anterior: "Micro anterior", pele_oleosa: "Pele oleosa", sobrancelha: "Sobrancelha",
  estilo: "Estilo preferido", extensao_atual: "Extensão colada", saude: "Saúde",
};

function val(v: unknown) {
  if (v === true) return "Sim";
  if (v === false) return "Não";
  if (v == null || v === "") return "—";
  return typeof v === "object" ? JSON.stringify(v) : label(String(v));
}

export function FichaCliente({ lead, servicoNome }: { lead: Lead; servicoNome?: string | null }) {
  const extras = Object.entries(lead.ficha ?? {}).filter(([, v]) => v != null && v !== "");
  return (
    <dl className="fields">
      <dt>Interesse</dt><dd>{servicoNome ?? lead.procedimento_interesse ?? "—"}</dd>
      {lead.tecnica_interesse && <><dt>Técnica</dt><dd>{label(lead.tecnica_interesse)}</dd></>}
      <dt>Turno</dt><dd>{label(lead.turno_preferido)}</dd>
      <dt>Aniversário</dt><dd>{lead.birthday ? new Date(lead.birthday + "T12:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "—"}</dd>
      <dt>Origem</dt><dd>{label(lead.source)}</dd>
      {extras.map(([k, v]) => (<Fragment key={k}><dt>{FICHA_LABELS[k] ?? k.replace(/_/g, " ")}</dt><dd>{val(v)}</dd></Fragment>))}
    </dl>
  );
}

export function Atendimento({ lead }: { lead: Lead }) {
  return (
    <dl className="fields">
      <dt>1º contato</dt><dd>{fmtDateTime(lead.first_message_at)}</dd>
      <dt>Na etapa há</dt><dd>{timeAgo(lead.stage_changed_at)}</dd>
      <dt>Follow-ups</dt><dd>{lead.followup_count}</dd>
      <dt>Cadastro</dt><dd>{fmtDate(lead.created_at)}</dd>
    </dl>
  );
}

export function ListaAgendamentos({ items }: { items: Agendamento[] }) {
  if (!items.length) return <div className="muted">Nenhum horário marcado.</div>;
  return (
    <div className="grid" style={{ gap: 8 }}>
      {items.map((a) => (
        <div key={a.id} style={{ borderLeft: "3px solid var(--brand)", paddingLeft: 10 }}>
          <b>{fmtWhen(a.inicio)}</b> <span className={`badge ${AG_STATUS[a.status]?.cls ?? ""}`}>{AG_STATUS[a.status]?.label ?? a.status}</span>
          <div>{a.descricao}</div>
          <div className="muted" style={{ fontSize: 12 }}>{brl(a.valor)}{a.sinal_valor ? ` · sinal ${brl(a.sinal_valor)}${a.sinal_pago ? " (pago)" : ""}` : ""} · {a.origem === "ia" ? "marcado pela Laura" : "marcado pela equipe"}</div>
        </div>
      ))}
    </div>
  );
}
