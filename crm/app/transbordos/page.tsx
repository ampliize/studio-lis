"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { supabase, type Handoff, type Lead } from "@/lib/supabase";
import { displayName, fmtDateTime, fmtDuration, label } from "@/lib/labels";

type Row = Handoff & { leads: Pick<Lead, "id" | "name" | "whatsapp_name" | "phone" | "procedimento_interesse"> };

export default function HandoffsPage() {
  return <Shell><Inner /></Shell>;
}

function Inner() {
  const [rows, setRows] = useState<Row[]>([]);
  const [tab, setTab] = useState<"aberto" | "devolvido">("aberto");

  const load = () =>
    supabase.from("handoffs").select("*, leads(id,name,whatsapp_name,phone,procedimento_interesse)")
      .eq("status", tab).order("opened_at", { ascending: tab === "aberto" }).limit(300)
      .then(({ data }) => setRows((data as Row[]) ?? []));

  useEffect(() => {
    load();
    const ch = supabase.channel("handoffs-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "handoffs" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function giveBack(leadId: string) {
    const { data } = await supabase.auth.getUser();
    await supabase.rpc("sdr_return_to_ai", { p_lead_id: leadId, p_by: data.user?.email ?? "equipe" });
    load();
  }

  return (
    <>
      <div className="page-head">
        <h1>Conversas com a Lis</h1>
        <div className="seg">
          <button className={tab === "aberto" ? "on" : ""} onClick={() => setTab("aberto")}>Aguardando a Lis</button>
          <button className={tab === "devolvido" ? "on" : ""} onClick={() => setTab("devolvido")}>Devolvidos</button>
        </div>
      </div>
      <p className="muted intro">
        Quando a cliente precisa de avaliação de foto, quer remarcar, mandou comprovante ou pediu para falar com você, a Laura pausa naquela conversa e ela aparece aqui.
        Responda pela tela de Conversas (ou pelo WhatsApp) e clique em “Devolver para a Laura” para ela continuar. Se você responder pelo celular e parar, a Laura volta sozinha depois de 3 horas.
      </p>
      <div className="card p0 table-wrap">
        <table className="stack">
          <thead><tr><th>Cliente</th><th>Motivo</th><th>Resumo da Laura</th><th>{tab === "aberto" ? "Esperando há" : "Devolvido"}</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-label="Cliente"><Link href={`/leads/${r.lead_id}`}><b>{displayName(r.leads)}</b></Link><div className="muted">{r.leads.procedimento_interesse ?? ""}</div></td>
                <td data-label="Motivo"><span className="badge warn">{label(r.reason)}</span></td>
                <td data-label="Resumo" style={{ maxWidth: 420 }}>{r.summary ?? "—"}</td>
                <td data-label={tab === "aberto" ? "Esperando há" : "Devolvido"}>{tab === "aberto" ? fmtDuration((Date.now() - new Date(r.opened_at).getTime()) / 1000) : <>{fmtDateTime(r.returned_at)}<div className="muted">{r.returned_by}</div></>}</td>
                <td className="actions" style={{ whiteSpace: "nowrap" }}>{tab === "aberto" && <><Link className="btn sm" href={`/conversas?lead=${r.lead_id}`}>Responder</Link>{" "}<button className="btn sm primary" onClick={() => giveBack(r.lead_id)}>Devolver para a Laura</button></>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="muted">{tab === "aberto" ? "Nenhuma cliente aguardando você." : "Nenhum transbordo devolvido."}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
