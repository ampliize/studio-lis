-- Studio Lis Cazais — Assistente "Laura" (WhatsApp) + CRM
-- Jornada da cliente:
--   novo -> em_atendimento -> interessada -> (aguardando_sinal) -> agendado -> atendida
--   (no_show / perdido / lista_laser_day em qualquer ponto)

create schema if not exists private;

-- ---------------------------------------------------------------- equipe (quem entra no CRM)
create table public.equipe (
  email text primary key,
  nome text,
  created_at timestamptz not null default now()
);

create or replace function public.is_equipe() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.equipe e where lower(e.email) = lower(coalesce(auth.jwt()->>'email', '')))
$$;

-- ---------------------------------------------------------------- configuração (editável no CRM)
create table public.config_bot (
  chave text primary key,
  valor text,
  descricao text,
  updated_at timestamptz not null default now()
);

create or replace function public.cfg(p_chave text) returns text
language sql stable security definer set search_path = '' as $$
  select valor from public.config_bot where chave = p_chave
$$;

-- segredo que o n8n manda no header x-lis-token (as funções do agente recusam sem ele)
create table private.segredos (chave text primary key, valor text not null);
insert into private.segredos values ('n8n_token', encode(extensions.gen_random_bytes(24), 'hex'));

create or replace function public.lis_exigir_n8n() returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_tok text; v_role text;
begin
  -- dentro de SECURITY DEFINER o current_user é o dono; o papel real vem do JWT da requisição
  v_role := nullif(current_setting('request.jwt.claims', true), '')::json->>'role';
  if v_role is null or v_role = 'service_role' then return; end if;      -- SQL direto / service_role
  if v_role = 'authenticated' and public.is_equipe() then return; end if; -- equipe logada no CRM
  v_tok := coalesce(current_setting('request.headers', true), '{}')::json->>'x-lis-token';
  if v_tok is null or v_tok <> (select valor from private.segredos where chave = 'n8n_token') then
    raise exception 'nao_autorizado' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------- catálogo de serviços
create table public.servicos (
  codigo text primary key,                 -- ex.: micro_sobrancelha
  categoria text not null,                 -- sobrancelhas | cilios | labios | depilacao | laser | cursos
  nome text not null,
  preco numeric(10,2),                     -- null = precisa de avaliação
  preco_texto text,                        -- quando o preço não é fixo (ex.: "a partir de", "avaliar")
  duracao_min int not null default 60,
  agendavel boolean not null default true, -- false = IA não agenda (transfere ou registra interesse)
  so_laser_day boolean not null default false,
  requer_avaliacao boolean not null default false,
  durabilidade text,
  descricao text,
  retorno_dias int,                        -- lembrete de manutenção/retorno depois de atendida
  retorno_servico text,                    -- serviço sugerido no retorno
  ordem int not null default 100,
  ativo boolean not null default true
);

-- ---------------------------------------------------------------- horários de atendimento
create table public.horarios_atendimento (
  dia_semana int primary key check (dia_semana between 0 and 6), -- 0 = domingo
  aberto boolean not null default true,
  inicio time not null default '08:00',
  fim time not null default '18:00'
);

-- bloqueios manuais (compromissos da Lis, horários já ocupados no app Minha Agenda, folgas)
create table public.bloqueios (
  id uuid primary key default gen_random_uuid(),
  inicio timestamptz not null,
  fim timestamptz not null check (fim > inicio),
  motivo text,
  created_at timestamptz not null default now()
);
create index bloqueios_periodo_idx on public.bloqueios(inicio, fim);

-- Laser Day (1x por mês, normalmente 2 dias seguidos)
create table public.laser_days (
  id uuid primary key default gen_random_uuid(),
  data date not null unique,
  inicio time not null default '08:00',
  fim time not null default '18:00',
  vagas int not null default 8,
  obs text
);

-- ---------------------------------------------------------------- clientes (leads)
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,                 -- 5571999999999
  whatsapp_name text,
  name text,
  birthday date,
  procedimento_interesse text,                -- código do serviço
  tecnica_interesse text,                     -- microblading | shadow | shading_line | ...
  turno_preferido text,                       -- manha | tarde
  ficha jsonb not null default '{}',          -- respostas do questionário (primeira vez, pele, falhas, saúde...)
  source text default 'whatsapp',             -- indicacao | instagram | cliente_antiga | anuncio | whatsapp
  stage text not null default 'novo' check (stage in
    ('novo','em_atendimento','interessada','aguardando_sinal','agendado','atendida','no_show','perdido','lista_laser_day')),
  lost_reason text,
  ai_paused boolean not null default false,
  ai_paused_reason text,
  ai_paused_at timestamptz,
  ia_processado_ate timestamptz,              -- última mensagem da cliente que a Laura já leu
  followup_count int not null default 0,
  first_message_at timestamptz,
  first_response_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  last_team_at timestamptz,
  scheduled_at timestamptz,
  stage_changed_at timestamptz not null default now(),
  team_seen_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_stage_idx on public.leads(stage);
create index leads_created_idx on public.leads(created_at);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  sender text not null check (sender in ('lead','ia','equipe','sistema')),
  type text not null default 'text',
  content text,
  wa_message_id text unique,
  created_at timestamptz not null default now()
);
create index messages_lead_idx on public.messages(lead_id, created_at);

create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  type text not null,
  from_stage text,
  to_stage text,
  actor text not null default 'sistema',
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index lead_events_lead_idx on public.lead_events(lead_id, created_at);
create index lead_events_type_idx on public.lead_events(type, created_at);

create table public.handoffs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  reason text not null,
  summary text,
  status text not null default 'aberto' check (status in ('aberto','devolvido')),
  opened_at timestamptz not null default now(),
  returned_at timestamptz,
  returned_by text
);
create index handoffs_open_idx on public.handoffs(status, opened_at);
create index handoffs_lead_idx on public.handoffs(lead_id);

-- ---------------------------------------------------------------- agendamentos
create table public.agendamentos (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  servicos text[] not null,                   -- códigos (combo = vários)
  descricao text not null,                    -- "Extensão de cílios Fox Eyes + Design com henna"
  inicio timestamptz not null,
  fim timestamptz not null check (fim > inicio),
  status text not null default 'confirmado' check (status in
    ('aguardando_sinal','confirmado','cancelado','atendido','no_show')),
  valor numeric(10,2),
  sinal_valor numeric(10,2),
  sinal_pago boolean not null default false,
  origem text not null default 'ia',          -- ia | equipe
  lembrete_24h_at timestamptz,
  lembrete_dia_at timestamptz,
  retorno_lembrado_at timestamptz,
  obs text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agendamentos_inicio_idx on public.agendamentos(inicio);
create index agendamentos_lead_idx on public.agendamentos(lead_id);

-- ---------------------------------------------------------------- fotos/vídeos que a Laura envia
create table public.midias (
  id uuid primary key default gen_random_uuid(),
  chave text not null,                        -- ex.: tecnicas_sobrancelha, cilios, labios, laser, como_chegar
  url text not null,
  tipo text not null default 'image' check (tipo in ('image','video','document')),
  legenda text,
  ordem int not null default 100,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create index midias_chave_idx on public.midias(chave, ordem);

-- ================================================================ triggers

create or replace function public.tg_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

create trigger leads_touch before update on public.leads for each row execute function public.tg_touch_updated_at();
create trigger agendamentos_touch before update on public.agendamentos for each row execute function public.tg_touch_updated_at();

create or replace function public.tg_lead_journey() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.lead_events(lead_id, type, to_stage, data)
    values (new.id, 'criado', new.stage, jsonb_build_object('source', new.source));
    return new;
  end if;
  if new.stage is distinct from old.stage then
    new.stage_changed_at = now();
    insert into public.lead_events(lead_id, type, from_stage, to_stage) values (new.id, 'etapa', old.stage, new.stage);
    if new.stage in ('agendado','aguardando_sinal') and new.scheduled_at is null then new.scheduled_at = now(); end if;
  end if;
  if new.ai_paused is distinct from old.ai_paused then
    insert into public.lead_events(lead_id, type, data)
    values (new.id, case when new.ai_paused then 'ia_pausada' else 'ia_retomada' end,
            jsonb_build_object('reason', coalesce(new.ai_paused_reason, old.ai_paused_reason)));
  end if;
  return new;
end $$;

create trigger leads_journey_ins after insert on public.leads for each row execute function public.tg_lead_journey();
create trigger leads_journey_upd before update on public.leads for each row execute function public.tg_lead_journey();

create or replace function public.tg_message_stats() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.direction = 'in' then
    update public.leads set
      last_inbound_at = new.created_at,
      first_message_at = coalesce(first_message_at, new.created_at),
      followup_count = 0,
      stage = case when stage in ('novo','perdido') then 'em_atendimento' else stage end
    where id = new.lead_id;
  else
    update public.leads set
      last_outbound_at = new.created_at,
      first_response_at = coalesce(first_response_at, new.created_at),
      last_team_at = case when new.sender = 'equipe' then new.created_at else last_team_at end
    where id = new.lead_id;
  end if;
  return new;
end $$;

create trigger messages_stats after insert on public.messages for each row execute function public.tg_message_stats();

-- ================================================================ segurança
alter table public.equipe enable row level security;
alter table public.config_bot enable row level security;
alter table public.servicos enable row level security;
alter table public.horarios_atendimento enable row level security;
alter table public.bloqueios enable row level security;
alter table public.laser_days enable row level security;
alter table public.leads enable row level security;
alter table public.messages enable row level security;
alter table public.lead_events enable row level security;
alter table public.handoffs enable row level security;
alter table public.agendamentos enable row level security;
alter table public.midias enable row level security;

do $$
declare t text;
begin
  foreach t in array array['config_bot','servicos','horarios_atendimento','bloqueios','laser_days','leads',
                           'messages','lead_events','handoffs','agendamentos','midias'] loop
    execute format('create policy equipe_all on public.%I for all to authenticated using (public.is_equipe()) with check (public.is_equipe())', t);
  end loop;
end $$;
create policy equipe_le on public.equipe for select to authenticated using (public.is_equipe());

alter publication supabase_realtime add table public.leads, public.messages, public.handoffs, public.agendamentos;
