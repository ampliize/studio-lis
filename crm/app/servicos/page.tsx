"use client";
import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { supabase, type Servico } from "@/lib/supabase";

type Horario = { dia_semana: number; aberto: boolean; inicio: string; fim: string };
const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const CAT: Record<string, string> = { sobrancelhas: "Sobrancelhas", cilios: "Cílios", labios: "Lábios", depilacao: "Depilação", laser: "Laser (Laser Day)", cursos: "Cursos" };

export default function ServicosPage() {
  return <Shell><Inner /></Shell>;
}

function Inner() {
  const [rows, setRows] = useState<Servico[]>([]);
  const [hor, setHor] = useState<Horario[]>([]);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [s, h] = await Promise.all([
      supabase.from("servicos").select("*").order("ordem"),
      supabase.from("horarios_atendimento").select("*").order("dia_semana"),
    ]);
    setRows((s.data as Servico[]) ?? []); setHor((h.data as Horario[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const edit = (codigo: string, patch: Partial<Servico>) => setRows((r) => r.map((x) => (x.codigo === codigo ? { ...x, ...patch } : x)));

  async function saveServico(s: Servico) {
    const { error } = await supabase.from("servicos").update({
      nome: s.nome, preco: s.preco, preco_texto: s.preco_texto, duracao_min: s.duracao_min, agendavel: s.agendavel,
      ativo: s.ativo, durabilidade: s.durabilidade, descricao: s.descricao, retorno_dias: s.retorno_dias,
    }).eq("codigo", s.codigo);
    setMsg(error ? `Erro: ${error.message}` : `${s.nome} salvo. A Laura já usa o valor novo.`);
  }

  async function saveHorario(h: Horario) {
    const { error } = await supabase.from("horarios_atendimento").update({ aberto: h.aberto, inicio: h.inicio, fim: h.fim }).eq("dia_semana", h.dia_semana);
    setMsg(error ? `Erro: ${error.message}` : `${DIAS[h.dia_semana]} salvo.`);
  }

  const cats = Array.from(new Set(rows.map((r) => r.categoria)));

  return (
    <>
      <div className="page-head"><div><h1>Serviços e horários</h1><p>Preços, duração e textos que a Laura usa para atender e montar a agenda.</p></div></div>
      {msg && <p className="muted">{msg}</p>}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Horário de funcionamento</h3>
        <div className="table-wrap">
          <table className="stack plain">
            <tbody>
              {hor.map((h) => (
                <tr key={h.dia_semana}>
                  <td data-label="Dia"><b>{DIAS[h.dia_semana]}</b></td>
                  <td data-label="Aberto"><label className="row"><input type="checkbox" checked={h.aberto} onChange={(e) => setHor((x) => x.map((y) => y.dia_semana === h.dia_semana ? { ...y, aberto: e.target.checked } : y))} />Atende</label></td>
                  <td data-label="Das"><input type="time" value={h.inicio.slice(0, 5)} onChange={(e) => setHor((x) => x.map((y) => y.dia_semana === h.dia_semana ? { ...y, inicio: e.target.value } : y))} /></td>
                  <td data-label="Até"><input type="time" value={h.fim.slice(0, 5)} onChange={(e) => setHor((x) => x.map((y) => y.dia_semana === h.dia_semana ? { ...y, fim: e.target.value } : y))} /></td>
                  <td className="actions"><button className="btn sm" onClick={() => saveHorario(h)}>Salvar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {cats.map((c) => (
        <div className="card p0 table-wrap" key={c} style={{ marginBottom: 16 }}>
          <div style={{ padding: "14px 18px", fontWeight: 600 }}>{CAT[c] ?? c}</div>
          <table className="stack">
            <thead><tr><th>Serviço</th><th>Preço (R$)</th><th>Duração (min)</th><th>Retorno (dias)</th><th>Laura agenda?</th><th>Ativo</th><th></th></tr></thead>
            <tbody>
              {rows.filter((r) => r.categoria === c).map((s) => (
                <tr key={s.codigo}>
                  <td data-label="Serviço" style={{ minWidth: 240 }}>
                    <input style={{ width: "100%" }} value={s.nome} onChange={(e) => edit(s.codigo, { nome: e.target.value })} />
                    {s.preco == null && <input style={{ width: "100%", marginTop: 4 }} placeholder="Texto do preço" value={s.preco_texto ?? ""} onChange={(e) => edit(s.codigo, { preco_texto: e.target.value })} />}
                  </td>
                  <td data-label="Preço"><input type="number" step="0.01" style={{ width: 100 }} value={s.preco ?? ""} onChange={(e) => edit(s.codigo, { preco: e.target.value === "" ? null : Number(e.target.value) })} /></td>
                  <td data-label="Duração"><input type="number" style={{ width: 80 }} value={s.duracao_min} onChange={(e) => edit(s.codigo, { duracao_min: Number(e.target.value) })} /></td>
                  <td data-label="Retorno"><input type="number" style={{ width: 80 }} value={s.retorno_dias ?? ""} onChange={(e) => edit(s.codigo, { retorno_dias: e.target.value === "" ? null : Number(e.target.value) })} /></td>
                  <td data-label="Laura agenda?"><input type="checkbox" checked={s.agendavel} onChange={(e) => edit(s.codigo, { agendavel: e.target.checked })} /></td>
                  <td data-label="Ativo"><input type="checkbox" checked={s.ativo} onChange={(e) => edit(s.codigo, { ativo: e.target.checked })} /></td>
                  <td className="actions"><button className="btn sm" onClick={() => saveServico(s)}>Salvar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
