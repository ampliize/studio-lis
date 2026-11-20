-- Funções usadas pelo CRM (usuárias logadas e cadastradas em public.equipe)

create or replace function public.crm_inbox(p_filtro text default 'todas', p_busca text default null)
returns table (id uuid, phone text, nome text, procedimento text, stage text, ai_paused boolean,
               ultima_msg text, ultima_de text, ultima_em timestamptz, nao_lida boolean, handoff_motivo text)
language sql stable security definer set search_path = '' as $$
  select l.id, l.phone, coalesce(l.name, l.whatsapp_name, l.phone) nome,
         (select s.nome from public.servicos s where s.codigo = l.procedimento_interesse), l.stage, l.ai_paused,
         m.content, m.sender, coalesce(m.created_at, l.created_at),
         (m.sender = 'lead' and (l.team_seen_at is null or l.team_seen_at < m.created_at)) nao_lida,
         (select h.reason from public.handoffs h where h.lead_id = l.id and h.status = 'aberto' limit 1)
    from public.leads l
    left join lateral (select content, sender, created_at from public.messages where lead_id = l.id order by created_at desc limit 1) m on true
   where public.is_equipe()
     and (p_busca is null or coalesce(l.name, '') ilike '%' || p_busca || '%' or coalesce(l.whatsapp_name, '') ilike '%' || p_busca || '%'
          or l.phone like '%' || regexp_replace(p_busca, '\D', '', 'g') || '%' and regexp_replace(p_busca, '\D', '', 'g') <> '')
     and case p_filtro
           when 'nao_lidas' then m.sender = 'lead' and (l.team_seen_at is null or l.team_seen_at < m.created_at)
           when 'equipe' then l.ai_paused
           when 'ia' then not l.ai_paused
           else true end
   order by coalesce(m.created_at, l.created_at) desc
   limit 300
$$;

create or replace function public.crm_metrics(p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer set search_path = '' as $$
with l as (select * from public.leads where created_at >= p_from and created_at < p_to and public.is_equipe()),
     ag as (select * from public.agendamentos where created_at >= p_from and created_at < p_to and public.is_equipe())
select jsonb_build_object(
  'leads',              (select count(*) from l),
  'em_atendimento',     (select count(*) from l where stage in ('em_atendimento','interessada')),
  'agendados',          (select count(*) from l where scheduled_at is not null),
  'atendidas',          (select count(*) from l where stage = 'atendida'),
  'no_show',            (select count(*) from ag where status = 'no_show'),
  'perdidos',           (select count(*) from l where stage = 'perdido'),
  'lista_laser_day',    (select count(*) from public.leads where stage = 'lista_laser_day' and public.is_equipe()),
  'taxa_agendamento',   (select round(100.0 * count(*) filter (where scheduled_at is not null) / nullif(count(*), 0), 1) from l),
  'tempo_1a_resposta_seg', (select round(avg(extract(epoch from first_response_at - first_message_at))) from l where first_response_at > first_message_at),
  'tempo_ate_agendar_h',(select round((avg(extract(epoch from scheduled_at - first_message_at)) / 3600)::numeric, 1) from l where scheduled_at > first_message_at),
  'agendamentos',       (select count(*) from ag where status <> 'cancelado'),
  'agendamentos_ia',    (select count(*) from ag where status <> 'cancelado' and origem = 'ia'),
  'faturamento_agendado', (select coalesce(sum(valor), 0) from ag where status <> 'cancelado'),
  'faturamento_realizado', (select coalesce(sum(valor), 0) from public.agendamentos where status = 'atendido' and inicio >= p_from and inicio < p_to and public.is_equipe()),
  'ticket_medio',       (select round(avg(valor), 2) from ag where status <> 'cancelado' and valor > 0),
  'msgs_recebidas',     (select count(*) from public.messages m where m.direction = 'in' and m.created_at >= p_from and m.created_at < p_to and public.is_equipe()),
  'msgs_enviadas_ia',   (select count(*) from public.messages m where m.sender = 'ia' and m.created_at >= p_from and m.created_at < p_to and public.is_equipe()),
  'msgs_enviadas_equipe', (select count(*) from public.messages m where m.sender = 'equipe' and m.created_at >= p_from and m.created_at < p_to and public.is_equipe()),
  'transbordos',        (select count(*) from public.handoffs h where h.opened_at >= p_from and h.opened_at < p_to and public.is_equipe()),
  'transbordos_abertos',(select count(*) from public.handoffs h where h.status = 'aberto' and public.is_equipe()),
  'followups',          (select count(*) from public.lead_events e where e.type = 'followup' and e.created_at >= p_from and e.created_at < p_to and public.is_equipe()),
  'retornos',           (select count(*) from public.lead_events e where e.type = 'lembrete_retorno' and e.created_at >= p_from and e.created_at < p_to and public.is_equipe()),
  'por_origem',         (select coalesce(jsonb_object_agg(k, n), '{}') from (select coalesce(source, 'whatsapp') k, count(*) n from l group by 1) s),
  'por_procedimento',   (select coalesce(jsonb_object_agg(k, n), '{}') from (select coalesce((select nome from public.servicos where codigo = l.procedimento_interesse), 'Não informado') k, count(*) n from l group by 1) s),
  'agendados_por_servico', (select coalesce(jsonb_object_agg(k, n), '{}') from (select descricao k, count(*) n from ag where status <> 'cancelado' group by 1) s),
  'motivos_transbordo', (select coalesce(jsonb_object_agg(reason, n), '{}') from (select reason, count(*) n from public.handoffs h where h.opened_at >= p_from and h.opened_at < p_to and public.is_equipe() group by 1) s),
  'motivos_perda',      (select coalesce(jsonb_object_agg(k, n), '{}') from (select coalesce(lost_reason, 'outro') k, count(*) n from l where stage = 'perdido' group by 1) s),
  'por_dia',            (select coalesce(jsonb_agg(jsonb_build_object('dia', d, 'leads', n, 'agendados', a) order by d), '[]')
                           from (select (created_at at time zone 'America/Bahia')::date d, count(*) n, count(*) filter (where scheduled_at is not null) a from l group by 1) s)
)
$$;

create or replace function public.crm_heatmap(p_from timestamptz, p_to timestamptz)
returns table (dow int, hora int, total bigint)
language sql stable security definer set search_path = '' as $$
  select extract(dow from created_at at time zone 'America/Bahia')::int, extract(hour from created_at at time zone 'America/Bahia')::int, count(*)
    from public.messages where direction = 'in' and created_at >= p_from and created_at < p_to and public.is_equipe()
   group by 1, 2
$$;

create or replace function public.sdr_return_to_ai(p_lead_id uuid, p_by text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_equipe() then raise exception 'nao_autorizado'; end if;
  update public.handoffs set status = 'devolvido', returned_at = now(), returned_by = p_by where lead_id = p_lead_id and status = 'aberto';
  -- a Laura não responde de novo o que a Lis já tratou; volta a responder a próxima mensagem da cliente
  update public.leads set ai_paused = false, ai_paused_reason = null, ai_paused_at = null,
         ia_processado_ate = greatest(coalesce(ia_processado_ate, last_inbound_at), last_inbound_at)
   where id = p_lead_id;
end $$;

create or replace function public.crm_assumir(p_lead_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_equipe() then raise exception 'nao_autorizado'; end if;
  perform public.lis_handoff_interno(p_lead_id, 'equipe_assumiu', 'Atendimento assumido manualmente por ' || coalesce(auth.jwt()->>'email', 'equipe') || '.');
end $$;

-- horários livres para a equipe marcar pelo CRM (mesma regra da Laura)
create or replace function public.crm_horarios(p_servicos text, p_data text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_equipe() then raise exception 'nao_autorizado'; end if;
  return public.lis_horarios(null, p_servicos, p_data, null);
end $$;

revoke execute on function public.crm_inbox(text, text), public.crm_metrics(timestamptz, timestamptz), public.crm_heatmap(timestamptz, timestamptz),
  public.sdr_return_to_ai(uuid, text), public.crm_assumir(uuid), public.crm_horarios(text, text) from public, anon;
grant execute on function public.crm_inbox(text, text), public.crm_metrics(timestamptz, timestamptz), public.crm_heatmap(timestamptz, timestamptz),
  public.sdr_return_to_ai(uuid, text), public.crm_assumir(uuid), public.crm_horarios(text, text) to authenticated;
