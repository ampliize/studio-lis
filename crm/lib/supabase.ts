import { createClient } from "@supabase/supabase-js";

// URL e chave publicável são públicas por natureza (a segurança vem do login + RLS + tabela equipe).
// Ficam no código para o deploy na Vercel não precisar de variáveis de ambiente.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://neeffqfzbvxqxfwoftbl.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_iS93zT12uBq55epPufA5vQ_gphipgIR";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export type Stage =
  | "novo" | "em_atendimento" | "interessada" | "aguardando_sinal" | "agendado"
  | "atendida" | "no_show" | "perdido" | "lista_laser_day";

export type Lead = {
  id: string; phone: string; whatsapp_name: string | null; name: string | null; birthday: string | null;
  procedimento_interesse: string | null; tecnica_interesse: string | null; turno_preferido: string | null;
  ficha: Record<string, unknown>; source: string | null; stage: Stage; lost_reason: string | null;
  ai_paused: boolean; ai_paused_reason: string | null; ai_paused_at: string | null;
  followup_count: number; first_message_at: string | null; first_response_at: string | null;
  last_inbound_at: string | null; last_outbound_at: string | null; scheduled_at: string | null;
  notes: string | null; created_at: string; updated_at: string; stage_changed_at: string; team_seen_at: string | null;
};

export type Message = {
  id: string; lead_id: string; direction: "in" | "out"; sender: "lead" | "ia" | "equipe" | "sistema";
  type: string; content: string | null; created_at: string;
};

export type LeadEvent = {
  id: string; lead_id: string; type: string; from_stage: Stage | null; to_stage: Stage | null;
  actor: string; data: Record<string, unknown>; created_at: string;
};

export type Handoff = {
  id: string; lead_id: string; reason: string; summary: string | null; status: "aberto" | "devolvido";
  opened_at: string; returned_at: string | null; returned_by: string | null;
};

export type AgStatus = "aguardando_sinal" | "confirmado" | "cancelado" | "atendido" | "no_show";
export type Agendamento = {
  id: string; lead_id: string; servicos: string[]; descricao: string; inicio: string; fim: string; status: AgStatus;
  valor: number | null; sinal_valor: number | null; sinal_pago: boolean; origem: string; obs: string | null; created_at: string;
};

export type Servico = {
  codigo: string; categoria: string; nome: string; preco: number | null; preco_texto: string | null; duracao_min: number;
  agendavel: boolean; so_laser_day: boolean; requer_avaliacao: boolean; durabilidade: string | null; descricao: string | null;
  retorno_dias: number | null; retorno_servico: string | null; ordem: number; ativo: boolean;
};
