"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Bot, Download, Hand, Search, Users } from "lucide-react";
import Shell from "@/components/Shell";
import { Avatar, Empty, StageBadge, timeAgo } from "@/components/ui";
import { supabase, type Lead } from "@/lib/supabase";
import { STAGES, displayName, fmtDateTime, fmtPhone, label } from "@/lib/labels";

export default function LeadsPage() {
  return <Shell><LeadsInner /></Shell>;
}

function LeadsInner() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");

  useEffect(() => {
    const load = () => supabase.from("leads").select("*").order("created_at", { ascending: false }).limit(2000)
      .then(({ data }) => setLeads((data as Lead[]) ?? []));
    load();
    const ch = supabase.channel("leads-list").on("postgres_changes", { event: "*", schema: "public", table: "leads" }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return leads.filter((l) => (!stage || l.stage === stage) &&
      (!t || [l.name, l.whatsapp_name, l.phone, l.procedimento_interesse].some((v) => v?.toLowerCase().includes(t))));
  }, [leads, q, stage]);

  function exportCsv() {
    const cols: (keyof Lead)[] = ["name", "whatsapp_name", "phone", "birthday", "procedimento_interesse", "tecnica_interesse", "turno_preferido", "source", "stage", "created_at", "scheduled_at", "notes"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [cols.join(";"), ...filtered.map((l) => cols.map((c) => esc(l[c])).join(";"))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `clientes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Clientes</h1><p>{filtered.length} de {leads.length} clientes</p></div>
        <div className="toolbar">
          <div className="search"><Search size={16} /><input placeholder="Buscar nome, telefone, procedimento…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">Todas as etapas</option>
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <button className="btn" onClick={exportCsv}><Download size={15} /><span className="hide-sm">Exportar </span>CSV</button>
        </div>
      </div>
      <div className="card p0 table-wrap">
        {filtered.length === 0 ? <Empty icon={<Users size={28} />} title="Nenhuma cliente encontrada" /> : (
          <table>
            <thead><tr><th>Cliente</th><th className="hide-sm">Interesse</th><th className="hide-md">Origem</th><th>Etapa</th><th className="hide-sm">Com</th><th className="hide-md">Última msg</th><th className="hide-md">Entrou</th></tr></thead>
            <tbody>
              {filtered.map((l) => (
                <tr key={l.id} className="click" onClick={() => router.push(`/leads/${l.id}`)}>
                  <td><div className="row" style={{ gap: 10 }}><Avatar name={displayName(l)} size="sm" /><div><b>{displayName(l)}</b><div className="muted" style={{ fontSize: 12 }}>{fmtPhone(l.phone)}</div></div></div></td>
                  <td className="hide-sm">{l.procedimento_interesse ?? "—"}</td>
                  <td className="hide-md">{label(l.source)}</td>
                  <td><StageBadge stage={l.stage} /></td>
                  <td className="hide-sm">{l.ai_paused ? <span className="badge amber"><Hand size={11} />Lis</span> : <span className="badge brand"><Bot size={11} />Laura</span>}</td>
                  <td className="hide-md">{timeAgo(l.last_inbound_at)}</td>
                  <td className="hide-md">{fmtDateTime(l.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
