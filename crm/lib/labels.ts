import type { AgStatus, Stage } from "./supabase";

export const STAGES: { key: Stage; label: string; color: string }[] = [
  { key: "novo", label: "Novo contato", color: "var(--c-gray)" },
  { key: "em_atendimento", label: "Em atendimento", color: "var(--c-blue)" },
  { key: "interessada", label: "Interessada", color: "var(--c-violet)" },
  { key: "aguardando_sinal", label: "Aguardando sinal", color: "var(--c-amber)" },
  { key: "agendado", label: "Agendada", color: "var(--c-green)" },
  { key: "atendida", label: "Atendida", color: "var(--c-teal)" },
  { key: "lista_laser_day", label: "Lista Laser Day", color: "var(--c-violet)" },
  { key: "no_show", label: "Não compareceu", color: "var(--c-amber)" },
  { key: "perdido", label: "Perdida", color: "var(--c-red)" },
];
export const stageLabel = (s: string | null | undefined) => STAGES.find((x) => x.key === s)?.label ?? s ?? "—";
export const stageColor = (s: string | null | undefined) => STAGES.find((x) => x.key === s)?.color ?? "var(--c-gray)";

export const AG_STATUS: Record<AgStatus, { label: string; cls: string }> = {
  aguardando_sinal: { label: "Aguardando sinal", cls: "amber" },
  confirmado: { label: "Confirmado", cls: "ok" },
  cancelado: { label: "Cancelado", cls: "" },
  atendido: { label: "Atendido", cls: "brand" },
  no_show: { label: "Não compareceu", cls: "warn" },
};

const DICT: Record<string, string> = {
  indicacao: "Indicação", instagram: "Instagram", cliente_antiga: "Cliente antiga", anuncio: "Anúncio", google: "Google", whatsapp: "WhatsApp",
  manha: "Manhã", tarde: "Tarde", microblading: "Microblading (fio a fio)", shadow: "Shadow (sombreada)", shading_line: "Shading Line",
  avaliacao_foto: "Avaliar foto", micro_antiga: "Micro antiga (avaliar)", avaliacao_labios: "Avaliar lábios", remocao_tatuagem: "Remoção de tatuagem",
  reagendamento: "Remarcar horário", cancelamento: "Cancelamento", comprovante: "Comprovante de sinal", cursos: "Cursos", saude: "Saúde",
  pediu_humano: "Pediu a Lis", reclamacao: "Reclamação", negociacao: "Pediu desconto", agenda_cheia: "Agenda cheia",
  nao_sabe_responder: "Laura não soube responder", erro: "Erro técnico", equipe_respondeu: "Lis respondeu pelo celular", equipe_assumiu: "Assumido no CRM",
  sem_resposta: "Sem resposta", nao_informado: "Não informado", outro: "Outro",
  criado: "Primeiro contato", etapa: "Mudou de etapa", ia_pausada: "Laura pausada (com a Lis)", ia_retomada: "Devolvido para a Laura",
  followup: "Follow-up enviado", agendamento_criado: "Horário agendado", lembrete_agendamento: "Lembrete do horário enviado",
  lembrete_retorno: "Lembrete de manutenção enviado", aniversario: "Mensagem de aniversário",
};
export const label = (k: string | null | undefined) => (k ? DICT[k] ?? k : "—");

export const brl = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
export const fmtWhen = (d: string) =>
  new Date(d).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
export const fmtDuration = (sec: number | null | undefined) => {
  if (sec == null) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)} h`;
  return `${(sec / 86400).toFixed(1)} dias`;
};
export const fmtPhone = (p: string) => {
  const d = p.replace(/\D/g, "").replace(/^55/, "");
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : p;
};
export const displayName = (l: { name: string | null; whatsapp_name: string | null; phone: string }) =>
  l.name || l.whatsapp_name || fmtPhone(l.phone);
