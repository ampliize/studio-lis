"use client";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Bot, CalendarCheck, CalendarDays, CheckCircle2, Clock, LifeBuoy, MessageCircle, Repeat, Timer, UserPlus, Wallet, Zap } from "lucide-react";
import Shell from "@/components/Shell";
import { Avatar, Delta, Empty, Kpi, timeAgo } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { STAGES, brl, fmtDuration, label } from "@/lib/labels";

type Metrics = {
  leads: number; em_atendimento: number; agendados: number; atendidas: number; no_show: number; perdidos: number; lista_laser_day: number;
  taxa_agendamento: number | null; tempo_1a_resposta_seg: number | null; tempo_ate_agendar_h: number | null;
  agendamentos: number; agendamentos_ia: number; faturamento_agendado: number; faturamento_realizado: number; ticket_medio: number | null;
  msgs_recebidas: number; msgs_enviadas_ia: number; msgs_enviadas_equipe: number;
  transbordos: number; transbordos_abertos: number; followups: number; retornos: number;
  por_origem: Record<string, number>; por_procedimento: Record<string, number>; agendados_por_servico: Record<string, number>;
  motivos_transbordo: Record<string, number>; motivos_perda: Record<string, number>;
  por_dia: { dia: string; leads: number; agendados: number }[];
};
type Heat = { dow: number; hora: number; total: number };
type Attn = { id: string; nome: string; detalhe: string; quando: string | null; tipo: "transbordo" | "nao_lida" | "reuniao" };

const PERIODS = [{ k: 1, l: "Hoje" }, { k: 7, l: "7 dias" }, { k: 30, l: "30 dias" }, { k: 90, l: "90 dias" }];
const COLORS = ["#9C4E6C", "#B48C57", "#7A5C8E", "#C99A5B", "#C0646E", "#5E9A9A", "#D78DA9", "#8E7280"];
const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export default function Dashboard() {
  return <Shell><DashboardInner /></Shell>;
}

function range(days: number, offset = 0) {
  const end = new Date();
  if (days === 1) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - offset); const e = new Date(start); e.setDate(e.getDate() + 1);
    return { from: start, to: offset ? e : new Date(end.getTime() + 60_000) };
  }
  const to = new Date(end.getTime() - offset * days * 86400_000 + 60_000);
  return { from: new Date(to.getTime() - days * 86400_000), to };
}

function DashboardInner() {
  const [days, setDays] = useState(30);
  const [m, setM] = useState<Metrics | null>(null);
  const [prev, setPrev] = useState<Metrics | null>(null);
  const [heat, setHeat] = useState<Heat[]>([]);
  const [stages, setStages] = useState<Record<string, number>>({});
  const [attn, setAttn] = useState<Attn[]>([]);

  useEffect(() => {
    const load = async () => {
      const cur = range(days), old = range(days, 1);
      const [a, b, h, st, ho, nl, mt] = await Promise.all([
        supabase.rpc("crm_metrics", { p_from: cur.from.toISOString(), p_to: cur.to.toISOString() }),
        supabase.rpc("crm_metrics", { p_from: old.from.toISOString(), p_to: old.to.toISOString() }),
        supabase.rpc("crm_heatmap", { p_from: cur.from.toISOString(), p_to: cur.to.toISOString() }),
        supabase.from("leads").select("stage"),
        supabase.from("handoffs").select("lead_id, reason, opened_at, leads(name, whatsapp_name, phone)").eq("status", "aberto").order("opened_at").limit(8),
        supabase.rpc("crm_inbox", { p_filtro: "nao_lidas", p_busca: null }),
        supabase.from("agendamentos").select("lead_id, inicio, descricao, leads(name, whatsapp_name, phone)").in("status", ["confirmado", "aguardando_sinal"]).gte("inicio", new Date().toISOString()).order("inicio").limit(6),
      ]);
      setM(a.data as Metrics); setPrev(b.data as Metrics); setHeat((h.data as Heat[]) ?? []);
      const counts: Record<string, number> = {};
      for (const r of (st.data as { stage: string }[]) ?? []) counts[r.stage] = (counts[r.stage] ?? 0) + 1;
      setStages(counts);
      type LeadRef = { name: string | null; whatsapp_name: string | null; phone: string };
      const nm = (l: LeadRef | null) => l?.name || l?.whatsapp_name || l?.phone || "Cliente";
      const list: Attn[] = [
        ...((ho.data as unknown as { lead_id: string; reason: string; opened_at: string; leads: LeadRef }[]) ?? []).map((x) => ({ id: x.lead_id, nome: nm(x.leads), detalhe: label(x.reason), quando: x.opened_at, tipo: "transbordo" as const })),
        ...((nl.data as { id: string; nome: string; ultima_msg: string; ultima_em: string; ai_paused: boolean }[]) ?? []).filter((x) => x.ai_paused).slice(0, 5).map((x) => ({ id: x.id, nome: x.nome, detalhe: x.ultima_msg, quando: x.ultima_em, tipo: "nao_lida" as const })),
        ...((mt.data as unknown as { lead_id: string; inicio: string; descricao: string; leads: LeadRef }[]) ?? []).map((x) => ({ id: x.lead_id, nome: nm(x.leads), detalhe: new Date(x.inicio).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + " · " + x.descricao, quando: null, tipo: "reuniao" as const })),
      ];
      setAttn(list);
    };
    load();
    const ch = supabase.channel("dash")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "handoffs" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [days]);

  const funnel = useMemo(() => m ? [
    { l: "Novos contatos", v: m.leads, c: "#B48C57" },
    { l: "Agendaram", v: m.agendados, c: "#9C4E6C" },
    { l: "Foram atendidas", v: m.atendidas, c: "#6FA287" },
  ] : [], [m]);

  const heatMax = Math.max(1, ...heat.map((h) => Number(h.total)));
  const automacao = m && m.msgs_enviadas_ia + m.msgs_enviadas_equipe > 0 ? Math.round((m.msgs_enviadas_ia / (m.msgs_enviadas_ia + m.msgs_enviadas_equipe)) * 100) : null;
  const origem = m ? Object.entries(m.por_origem).map(([k, v]) => ({ name: label(k), value: v })) : [];
  const totalAtivos = STAGES.reduce((s, x) => s + (stages[x.key] ?? 0), 0) || 1;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Painel do studio</h1>
          <p>Atendimento da Laura e da Lis, do primeiro contato até o procedimento.</p>
        </div>
        <div className="seg">{PERIODS.map((p) => <button key={p.k} className={days === p.k ? "on" : ""} onClick={() => setDays(p.k)}>{p.l}</button>)}</div>
      </div>

      {!m ? <div className="muted">Carregando indicadores…</div> : (
        <div className="grid" style={{ gap: 18 }}>
          <div className="grid kpis">
            <Kpi icon={<UserPlus size={17} />} label="Novos contatos" value={m.leads} delta={<Delta cur={m.leads} prev={prev?.leads} />} sub="vs período anterior" />
            <Kpi icon={<CalendarCheck size={17} />} label="Agendamentos" value={m.agendamentos} delta={<Delta cur={m.agendamentos} prev={prev?.agendamentos} />} sub={`${m.agendamentos_ia} pela Laura`} />
            <Kpi icon={<Wallet size={17} />} label="Valor agendado" value={brl(m.faturamento_agendado)} delta={<Delta cur={m.faturamento_agendado} prev={prev?.faturamento_agendado} />} sub={`ticket médio ${brl(m.ticket_medio)}`} />
            <Kpi icon={<CheckCircle2 size={17} />} label="Realizado" value={brl(m.faturamento_realizado)} delta={<Delta cur={m.faturamento_realizado} prev={prev?.faturamento_realizado} />} sub={`${m.no_show} faltas`} />
            <Kpi icon={<Timer size={17} />} label="1ª resposta (média)" value={fmtDuration(m.tempo_1a_resposta_seg)} delta={<Delta cur={m.tempo_1a_resposta_seg} prev={prev?.tempo_1a_resposta_seg} invert />} sub="do contato à resposta" />
            <Kpi icon={<Repeat size={17} />} label="Retornos lembrados" value={m.retornos} delta={<Delta cur={m.retornos} prev={prev?.retornos} />} sub="manutenção / retoque" />
          </div>

          <div className="grid three">
            <div className="card">
              <h3>Funil de conversão <small>no período</small></h3>
              <div className="funnel">
                {funnel.map((f, i) => {
                  const max = funnel[0].v || 1;
                  const prevStep = i > 0 ? funnel[i - 1].v : null;
                  return (
                    <div key={f.l} className="funnel-row">
                      <span className="lbl">{f.l}</span>
                      <div className="bar-bg"><div className="bar" style={{ width: `${Math.max((f.v / max) * 100, f.v ? 6 : 0)}%`, background: f.c }}>{f.v || ""}</div></div>
                      <span className="pct">{prevStep ? <><b>{Math.round((f.v / prevStep) * 100)}%</b> da etapa</> : <b>{f.v}</b>}</span>
                    </div>
                  );
                })}
              </div>
              <div className="row wrap" style={{ marginTop: 16, gap: 18 }}>
                <span className="muted">Conversão: <b style={{ color: "var(--text)" }}>{m.taxa_agendamento ?? 0}%</b> dos contatos agendam</span>
                <span className="muted">Tempo até agendar: <b style={{ color: "var(--text)" }}>{m.tempo_ate_agendar_h != null ? `${m.tempo_ate_agendar_h} h` : "—"}</b></span>
                <span className="muted">Lista Laser Day: <b style={{ color: "var(--text)" }}>{m.lista_laser_day}</b></span>
                <span className="muted">Perdidas: <b style={{ color: "var(--text)" }}>{m.perdidos}</b></span>
              </div>
            </div>

            <div className="card">
              <h3>Precisa de atenção <Link href="/conversas" className="muted" style={{ fontSize: 12 }}>ver conversas</Link></h3>
              {attn.length === 0 ? <Empty icon={<CheckCircle2 size={26} color="var(--ok)" />} title="Tudo em dia">Nenhuma cliente esperando você.</Empty> : (
                <div className="attn">
                  {attn.map((a, i) => (
                    <Link key={i} href={a.tipo === "reuniao" ? `/leads/${a.id}` : `/conversas?lead=${a.id}`}>
                      <Avatar name={a.nome} size="sm" />
                      <div className="t"><b>{a.nome}</b><span>{a.detalhe}</span></div>
                      {a.tipo === "transbordo" && <span className="badge warn"><LifeBuoy size={11} />{timeAgo(a.quando)}</span>}
                      {a.tipo === "nao_lida" && <span className="badge amber"><MessageCircle size={11} />nova</span>}
                      {a.tipo === "reuniao" && <span className="badge ok"><CalendarDays size={11} />horário</span>}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid three">
            <div className="card">
              <h3>Contatos e agendamentos por dia</h3>
              <div style={{ height: 260 }}>
                <ResponsiveContainer>
                  <AreaChart data={m.por_dia.map((d) => ({ ...d, dia: new Date(d.dia + "T12:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) }))}>
                    <defs>
                      <linearGradient id="gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#B48C57" stopOpacity={.35} /><stop offset="100%" stopColor="#B48C57" stopOpacity={0} /></linearGradient>
                      <linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#9C4E6C" stopOpacity={.4} /><stop offset="100%" stopColor="#9C4E6C" stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="dia" stroke="var(--muted)" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} stroke="var(--muted)" fontSize={12} tickLine={false} axisLine={false} width={28} />
                    <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10 }} />
                    <Legend iconType="circle" />
                    <Area type="monotone" dataKey="leads" name="Contatos" stroke="#B48C57" strokeWidth={2} fill="url(#gl)" />
                    <Area type="monotone" dataKey="agendados" name="Agendados" stroke="#9C4E6C" strokeWidth={2} fill="url(#ga)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="card">
              <h3>De onde vêm as clientes</h3>
              {origem.length === 0 ? <Empty icon={<UserPlus size={24} />} title="Sem dados no período" /> : (
                <div style={{ height: 260 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={origem} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={2}>
                        {origem.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10 }} />
                      <Legend iconType="circle" />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <div className="grid three">
            <div className="card">
              <h3>Quando as clientes chamam <small>mensagens recebidas por dia e hora</small></h3>
              <div className="heat-wrap"><div className="heat">
                <span />{Array.from({ length: 24 }, (_, h) => <span key={h} style={{ textAlign: "center" }}>{h % 3 === 0 ? h : ""}</span>)}
                {DOW.map((d, di) => (
                  <Fragment key={d}>
                    <span className="lbl">{d}</span>
                    {Array.from({ length: 24 }, (_, h) => {
                      const v = Number(heat.find((x) => x.dow === di && x.hora === h)?.total ?? 0);
                      return <span key={`${di}-${h}`} className="c" title={`${d} ${h}h: ${v} mensagens`} style={v ? { background: `rgba(156,78,108,${0.15 + (v / heatMax) * 0.85})` } : undefined} />;
                    })}
                  </Fragment>
                ))}
              </div></div>
            </div>
            <div className="card">
              <h3>Atendimento automático</h3>
              <div className="row" style={{ alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 34, fontWeight: 700 }}>{automacao != null ? `${automacao}%` : "—"}</span>
                <span className="muted">das mensagens enviadas pela Laura</span>
              </div>
              <div style={{ marginTop: 14 }}>
                <HBar l="Mensagens da Laura" v={m.msgs_enviadas_ia} max={Math.max(m.msgs_enviadas_ia, m.msgs_enviadas_equipe, 1)} c="#9C4E6C" icon={<Bot size={13} />} />
                <HBar l="Mensagens da Lis" v={m.msgs_enviadas_equipe} max={Math.max(m.msgs_enviadas_ia, m.msgs_enviadas_equipe, 1)} c="#4A2737" />
                <HBar l="Passadas para a Lis" v={m.transbordos} max={Math.max(m.leads, 1)} c="#C99A5B" icon={<LifeBuoy size={13} />} />
                <HBar l="Follow-ups automáticos" v={m.followups} max={Math.max(m.leads, m.followups, 1)} c="#B48C57" icon={<Zap size={13} />} />
              </div>
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            <div className="card">
              <h3>Funil agora <Link href="/pipeline" className="muted" style={{ fontSize: 12 }}>abrir</Link></h3>
              {STAGES.map((s) => <HBar key={s.key} l={s.label} v={stages[s.key] ?? 0} max={totalAtivos} c={s.color} />)}
            </div>
            <Breakdown title="Procedimento de interesse" data={m.por_procedimento} />
            <Breakdown title="Serviços agendados" data={m.agendados_por_servico} color="#7A5C8E" />
            <Breakdown title="Por que passou para a Lis" data={m.motivos_transbordo} color="#C99A5B" />
            <Breakdown title="Motivos de perda" data={m.motivos_perda} color="#8E7280" />
          </div>
        </div>
      )}
    </>
  );
}

function HBar({ l, v, max, c, icon }: { l: string; v: number; max: number; c: string; icon?: React.ReactNode }) {
  return (
    <div className="hbar">
      <span className="row" style={{ gap: 6, fontSize: 13 }}>{icon}{l}</span><b>{v}</b>
      <div className="track"><div className="fill" style={{ width: `${(v / (max || 1)) * 100}%`, background: c }} /></div>
    </div>
  );
}

function Breakdown({ title, data, color = "#9C4E6C" }: { title: string; data: Record<string, number>; color?: string }) {
  const rows = Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="card">
      <h3>{title}</h3>
      {rows.length === 0 ? <div className="muted">Sem dados no período.</div> : rows.map(([k, v]) => <HBar key={k} l={label(k)} v={v} max={max} c={color} />)}
    </div>
  );
}
