"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, Lock, Trash2, Zap } from "lucide-react";
import Shell from "@/components/Shell";
import { supabase, type Agendamento, type AgStatus, type Lead, type Servico } from "@/lib/supabase";
import { AG_STATUS, brl, displayName, fmtWhen } from "@/lib/labels";

type Row = Agendamento & { leads: Pick<Lead, "id" | "name" | "whatsapp_name" | "phone"> };
type Bloqueio = { id: string; inicio: string; fim: string; motivo: string | null };
type LaserDay = { id: string; data: string; inicio: string; fim: string; vagas: number; obs: string | null };
type Opcao = { inicio: string; legivel: string };

export default function AgendaPage() {
  return <Shell><Inner /></Shell>;
}

const dia = (d: string) => new Date(d).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
const hora = (d: string) => new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
// "2026-11-21T09:00" digitado no input (horário de Salvador, UTC-3) → ISO
const localToIso = (v: string) => (v ? new Date(v + ":00-03:00").toISOString() : "");

function Inner() {
  const [rows, setRows] = useState<Row[]>([]);
  const [tab, setTab] = useState<"proximos" | "passados">("proximos");
  const [bloqueios, setBloqueios] = useState<Bloqueio[]>([]);
  const [lasers, setLasers] = useState<LaserDay[]>([]);
  const [novo, setNovo] = useState(false);

  const load = useCallback(async () => {
    const now = new Date().toISOString();
    let q = supabase.from("agendamentos").select("*, leads(id,name,whatsapp_name,phone)");
    q = tab === "proximos" ? q.gte("fim", now).order("inicio") : q.lt("fim", now).order("inicio", { ascending: false });
    const [a, b, l] = await Promise.all([
      q.limit(300),
      supabase.from("bloqueios").select("*").gte("fim", now).order("inicio"),
      supabase.from("laser_days").select("*").gte("data", now.slice(0, 10)).order("data"),
    ]);
    setRows((a.data as Row[]) ?? []); setBloqueios((b.data as Bloqueio[]) ?? []); setLasers((l.data as LaserDay[]) ?? []);
  }, [tab]);

  useEffect(() => {
    load();
    const ch = supabase.channel("agenda").on("postgres_changes", { event: "*", schema: "public", table: "agendamentos" }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  async function setStatus(a: Row, status: AgStatus) {
    if (status === "cancelado" && !confirm("Cancelar este horário? Ele volta a ficar livre para a Laura oferecer.")) return;
    const patch: Partial<Agendamento> = { status };
    if (status === "confirmado" && a.status === "aguardando_sinal") patch.sinal_pago = true;
    await supabase.from("agendamentos").update(patch).eq("id", a.id);
    const stage = status === "atendido" ? "atendida" : status === "no_show" ? "no_show" : status === "confirmado" ? "agendado" : null;
    if (stage) await supabase.from("leads").update({ stage }).eq("id", a.lead_id);
    await supabase.from("lead_events").insert({ lead_id: a.lead_id, type: "agendamento_" + status, actor: "equipe" });
    load();
  }

  const grupos = useMemo(() => {
    const g: Record<string, Row[]> = {};
    for (const r of rows) (g[dia(r.inicio)] ??= []).push(r);
    return Object.entries(g);
  }, [rows]);

  return (
    <>
      <div className="page-head">
        <div><h1>Agenda</h1><p>Horários marcados pela Laura e pela Lis. Bloqueie aqui os horários que você ocupar no app Minha Agenda.</p></div>
        <div className="toolbar">
          <div className="seg">
            <button className={tab === "proximos" ? "on" : ""} onClick={() => setTab("proximos")}>Próximos</button>
            <button className={tab === "passados" ? "on" : ""} onClick={() => setTab("passados")}>Passados</button>
          </div>
          <button className="btn primary" onClick={() => setNovo((v) => !v)}><CalendarPlus size={15} />Novo horário</button>
        </div>
      </div>

      {novo && <NovoHorario onDone={() => { setNovo(false); load(); }} />}

      <div className="grid three">
        <div className="card p0 table-wrap">
          {grupos.length === 0 && <div className="muted" style={{ padding: 18 }}>Nenhum horário {tab === "proximos" ? "marcado" : "no histórico"}.</div>}
          {grupos.map(([d, items]) => (
            <div key={d}>
              <div style={{ padding: "10px 18px", background: "var(--panel-2)", fontWeight: 600, textTransform: "capitalize", borderBottom: "1px solid var(--border)" }}>{d}</div>
              <table className="stack">
                <tbody>
                  {items.map((a) => (
                    <tr key={a.id} style={a.status === "cancelado" ? { opacity: .5 } : undefined}>
                      <td data-label="Hora" style={{ width: 110 }}><b>{hora(a.inicio)}–{hora(a.fim)}</b></td>
                      <td data-label="Cliente"><Link href={`/leads/${a.lead_id}`}><b>{displayName(a.leads)}</b></Link><div className="muted" style={{ fontSize: 12 }}>{a.origem === "ia" ? "pela Laura" : "pela equipe"}</div></td>
                      <td data-label="Serviço">{a.descricao}<div className="muted" style={{ fontSize: 12 }}>{brl(a.valor)}{a.sinal_valor ? ` · sinal ${brl(a.sinal_valor)}${a.sinal_pago ? " pago" : ""}` : ""}</div></td>
                      <td data-label="Status"><span className={`badge ${AG_STATUS[a.status].cls}`}>{AG_STATUS[a.status].label}</span></td>
                      <td className="actions" style={{ whiteSpace: "nowrap" }}>
                        {a.status === "aguardando_sinal" && <button className="btn sm primary" onClick={() => setStatus(a, "confirmado")}>Sinal recebido</button>}
                        {(a.status === "confirmado" || a.status === "aguardando_sinal") && <>
                          {" "}{tab === "passados" && <button className="btn sm" onClick={() => setStatus(a, "atendido")}>Atendida</button>}
                          {" "}{tab === "passados" && <button className="btn sm danger" onClick={() => setStatus(a, "no_show")}>Faltou</button>}
                          {" "}<button className="btn sm danger" onClick={() => setStatus(a, "cancelado")}>Cancelar</button>
                        </>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        <div className="grid" style={{ alignContent: "start" }}>
          <Bloqueios items={bloqueios} onChange={load} />
          <LaserDays items={lasers} onChange={load} />
        </div>
      </div>
    </>
  );
}

function NovoHorario({ onDone }: { onDone: () => void }) {
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [fone, setFone] = useState("");
  const [nome, setNome] = useState("");
  const [data, setData] = useState("");
  const [opcoes, setOpcoes] = useState<Opcao[]>([]);
  const [msg, setMsg] = useState("");

  useEffect(() => { supabase.from("servicos").select("*").eq("ativo", true).eq("agendavel", true).order("ordem").then(({ data }) => setServicos((data as Servico[]) ?? [])); }, []);

  async function buscar() {
    setMsg(""); setOpcoes([]);
    if (!sel.length) { setMsg("Escolha ao menos um serviço."); return; }
    const { data: r, error } = await supabase.rpc("crm_horarios", { p_servicos: sel.join(","), p_data: data || null });
    if (error) { setMsg(error.message); return; }
    const res = r as { ok: boolean; opcoes?: Opcao[]; orientacao?: string };
    if (!res.ok) setMsg(res.orientacao ?? "Sem horários.");
    setOpcoes(res.opcoes ?? []);
  }

  async function marcar(o: Opcao) {
    const phone = fone.replace(/\D/g, "");
    if (phone.length < 10) { setMsg("Informe o WhatsApp da cliente com DDD."); return; }
    const full = phone.startsWith("55") ? phone : "55" + phone;
    let { data: lead } = await supabase.from("leads").select("id").eq("phone", full).maybeSingle();
    if (!lead) {
      const ins = await supabase.from("leads").insert({ phone: full, name: nome || null, source: "cliente_antiga", stage: "agendado" }).select("id").single();
      lead = ins.data;
    } else if (nome) await supabase.from("leads").update({ name: nome }).eq("id", lead.id);
    if (!lead) { setMsg("Não foi possível cadastrar a cliente."); return; }
    const sv = servicos.filter((s) => sel.includes(s.codigo));
    const dur = sv.reduce((t, s) => t + s.duracao_min, 0);
    const ini = new Date(o.inicio);
    const { error } = await supabase.from("agendamentos").insert({
      lead_id: lead.id, servicos: sel, descricao: sv.map((s) => s.nome).join(" + "), inicio: ini.toISOString(),
      fim: new Date(ini.getTime() + dur * 60000).toISOString(), status: "confirmado", valor: sv.reduce((t, s) => t + Number(s.preco ?? 0), 0), origem: "equipe",
    });
    if (error) { setMsg(error.message); return; }
    await supabase.from("leads").update({ stage: "agendado" }).eq("id", lead.id);
    onDone();
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3>Novo horário</h3>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <input placeholder="WhatsApp (71 99999-9999)" value={fone} onChange={(e) => setFone(e.target.value)} />
        <input placeholder="Nome da cliente" value={nome} onChange={(e) => setNome(e.target.value)} />
        <input type="date" value={data} onChange={(e) => setData(e.target.value)} title="Dia (vazio = próximos dias)" />
      </div>
      <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
        {servicos.map((s) => (
          <button key={s.codigo} className={`btn sm ${sel.includes(s.codigo) ? "primary" : ""}`}
            onClick={() => setSel((x) => x.includes(s.codigo) ? x.filter((c) => c !== s.codigo) : [...x, s.codigo])}>{s.nome}</button>
        ))}
      </div>
      <button className="btn" onClick={buscar}>Ver horários livres</button>
      {opcoes.length > 0 && <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
        {opcoes.map((o) => <button key={o.inicio} className="btn sm primary" onClick={() => marcar(o)}>Marcar {o.legivel}</button>)}
      </div>}
      {msg && <p className="muted">{msg}</p>}
    </div>
  );
}

function Bloqueios({ items, onChange }: { items: Bloqueio[]; onChange: () => void }) {
  const [ini, setIni] = useState(""); const [fim, setFim] = useState(""); const [motivo, setMotivo] = useState(""); const [err, setErr] = useState("");
  async function add() {
    setErr("");
    if (!ini || !fim) { setErr("Preencha início e fim."); return; }
    const { error } = await supabase.from("bloqueios").insert({ inicio: localToIso(ini), fim: localToIso(fim), motivo: motivo || null });
    if (error) { setErr(error.message); return; }
    setIni(""); setFim(""); setMotivo(""); onChange();
  }
  return (
    <div className="card">
      <h3><span className="row"><Lock size={15} />Bloquear horários</span></h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>A Laura não oferece horários bloqueados (folga, compromisso, horário já ocupado no Minha Agenda).</p>
      <div className="grid" style={{ gap: 6 }}>
        <input type="datetime-local" value={ini} onChange={(e) => setIni(e.target.value)} />
        <input type="datetime-local" value={fim} onChange={(e) => setFim(e.target.value)} />
        <input placeholder="Motivo (opcional)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        <button className="btn" onClick={add}>Bloquear</button>
        {err && <div style={{ color: "var(--danger)" }}>{err}</div>}
      </div>
      {items.map((b) => (
        <div key={b.id} className="row" style={{ marginTop: 8, justifyContent: "space-between" }}>
          <span style={{ fontSize: 13 }}><b>{fmtWhen(b.inicio)}</b> até {fmtWhen(b.fim)}{b.motivo ? ` · ${b.motivo}` : ""}</span>
          <button className="btn ghost sm" title="Remover" onClick={async () => { await supabase.from("bloqueios").delete().eq("id", b.id); onChange(); }}><Trash2 size={14} /></button>
        </div>
      ))}
    </div>
  );
}

function LaserDays({ items, onChange }: { items: LaserDay[]; onChange: () => void }) {
  const [data, setData] = useState(""); const [ini, setIni] = useState("08:00"); const [fim, setFim] = useState("18:00"); const [vagas, setVagas] = useState(8); const [err, setErr] = useState("");
  async function add() {
    setErr("");
    if (!data) { setErr("Escolha a data."); return; }
    const { error } = await supabase.from("laser_days").insert({ data, inicio: ini, fim, vagas });
    if (error) { setErr(error.message); return; }
    setData(""); onChange();
  }
  return (
    <div className="card">
      <h3><span className="row"><Zap size={15} />Laser Day</span></h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Serviços de laser só são agendados nestas datas. Nesses dias a agenda normal fica fechada. Clientes da lista de espera aparecem no Funil (Lista Laser Day).</p>
      <div className="grid" style={{ gap: 6 }}>
        <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        <div className="row"><input type="time" value={ini} onChange={(e) => setIni(e.target.value)} /><input type="time" value={fim} onChange={(e) => setFim(e.target.value)} /></div>
        <label className="row" style={{ fontSize: 13 }}>Vagas <input type="number" min={1} value={vagas} onChange={(e) => setVagas(Number(e.target.value))} style={{ width: 80 }} /></label>
        <button className="btn" onClick={add}>Adicionar Laser Day</button>
        {err && <div style={{ color: "var(--danger)" }}>{err}</div>}
      </div>
      {items.map((l) => (
        <div key={l.id} className="row" style={{ marginTop: 8, justifyContent: "space-between" }}>
          <span style={{ fontSize: 13 }}><b>{new Date(l.data + "T12:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}</b> · {l.inicio.slice(0, 5)}–{l.fim.slice(0, 5)} · {l.vagas} vagas</span>
          <button className="btn ghost sm" title="Remover" onClick={async () => { if (confirm("Remover este Laser Day?")) { await supabase.from("laser_days").delete().eq("id", l.id); onChange(); } }}><Trash2 size={14} /></button>
        </div>
      ))}
    </div>
  );
}
