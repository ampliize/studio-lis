"use client";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { stageColor, stageLabel } from "@/lib/labels";

const PALETTE = ["#9C4E6C", "#B48C57", "#7A5C8E", "#C99A5B", "#C0646E", "#5E9A9A", "#D78DA9", "#4A2737"];

export function Avatar({ name, size }: { name: string; size?: "sm" }) {
  const clean = (name || "?").replace(/[^\p{L}\s]/gu, "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  const ini = ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
  let h = 0;
  for (const ch of name || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return <span className={`avatar ${size ?? ""}`} style={{ background: PALETTE[h % PALETTE.length] }}>{ini}</span>;
}

export function StageBadge({ stage }: { stage: string }) {
  return <span className="badge"><span className="dot" style={{ background: stageColor(stage) }} />{stageLabel(stage)}</span>;
}

export function Delta({ cur, prev, invert }: { cur: number | null | undefined; prev: number | null | undefined; invert?: boolean }) {
  if (cur == null || prev == null) return null;
  if (prev === 0 && cur === 0) return <span className="delta flat"><Minus size={12} />0%</span>;
  const pct = prev === 0 ? 100 : Math.round(((cur - prev) / Math.abs(prev)) * 100);
  if (pct === 0) return <span className="delta flat"><Minus size={12} />0%</span>;
  const good = invert ? pct < 0 : pct > 0;
  return (
    <span className={`delta ${good ? "up" : "down"}`}>
      {pct > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{Math.abs(pct)}%
    </span>
  );
}

export function Kpi({ icon, label, value, sub, delta }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; delta?: ReactNode }) {
  return (
    <div className="card kpi">
      <div className="top"><span>{label}</span><span className="ico">{icon}</span></div>
      <div className="v">{value}</div>
      {(sub || delta) && <div className="s">{delta}{sub}</div>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return <div className="vazio"><span className="arco">{icon}</span><b>{title}</b>{children}</div>;
}

export function timeAgo(d: string | null | undefined) {
  if (!d) return "—";
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "agora";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d`;
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function hhmm(d: string) {
  return new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
