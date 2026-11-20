-- Funções usadas pelo n8n (assistente Laura). Todas exigem o header x-lis-token (ou service_role).

-- ================================================================ utilitários de data
create or replace function public.lis_local(p timestamptz) returns timestamp
language sql immutable set search_path = '' as $$ select p at time zone 'America/Bahia' $$;

create or replace function public.lis_legivel(p timestamptz) returns text
language sql stable set search_path = '' as $$
  select (array['domingo','segunda','terça','quarta','quinta','sexta','sábado'])[extract(dow from l)::int + 1]
         || ' (' || to_char(l, 'DD/MM') || ') às ' || extract(hour from l)::int || 'h'
         || case when extract(minute from l) > 0 then lpad(extract(minute from l)::int::text, 2, '0') else '' end
  from (select p at time zone 'America/Bahia' as l) s
$$;

create or replace function public.lis_brl(p numeric) returns text
language sql immutable set search_path = '' as $$
  select case when p is null then null else 'R$ ' || replace(to_char(p, 'FM999990.00'), '.', ',') end
$$;

-- ================================================================ catálogo em texto (vai no prompt)
create or replace function public.lis_catalogo_texto() returns text
language sql stable security definer set search_path = '' as $$
  select string_agg(
    '- [' || s.codigo || '] ' || s.nome || ': ' || coalesce(public.lis_brl(s.preco), s.preco_texto, 'consultar')
    || case when s.durabilidade is not null then ' | dura ' || s.durabilidade else '' end
    || case when s.so_laser_day then ' | só no Laser Day' else '' end
    || case when not s.agendavel then ' | NÃO agende: transfira' else '' end
    || case when s.descricao is not null then E'\n    ' || s.descricao else '' end,
    E'\n' order by s.ordem)
  from public.servicos s where s.ativo
$$;

-- ================================================================ agenda
create or replace function public.lis_codigos(p text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(x), '{}') from unnest(string_to_array(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9_,]', '', 'g'), ',')) x where x <> ''
$$;

-- janela de atendimento de um dia (expediente normal ou Laser Day)
create or replace function public.lis_janela_dia(p_dia date, p_laser boolean)
returns table (abre timestamptz, fecha timestamptz, vagas int)
language sql stable security definer set search_path = '' as $$
  select (p_dia + ld.inicio) at time zone 'America/Bahia', (p_dia + ld.fim) at time zone 'America/Bahia', ld.vagas
    from public.laser_days ld where p_laser and ld.data = p_dia
  union all
  select (p_dia + h.inicio) at time zone 'America/Bahia', (p_dia + h.fim) at time zone 'America/Bahia', null::int
    from public.horarios_atendimento h
   where not p_laser and h.aberto and h.dia_semana = extract(dow from p_dia)::int
     and not exists (select 1 from public.laser_days ld where ld.data = p_dia)  -- no Laser Day a agenda é só do laser
$$;

create or replace function public.lis_slot_livre(p_inicio timestamptz, p_fim timestamptz, p_ignorar uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
      select 1 from public.agendamentos a
       where a.status in ('aguardando_sinal','confirmado') and a.id is distinct from p_ignorar
         and a.inicio < p_fim and a.fim > p_inicio)
     and not exists (select 1 from public.bloqueios b where b.inicio < p_fim and b.fim > p_inicio)
$$;

-- valida serviços pedidos: devolve duração total, valor, se é laser e erros
create or replace function public.lis_validar_servicos(p_servicos text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_cod text[] := public.lis_codigos(p_servicos); v_err text := ''; r record;
        v_dur int := 0; v_valor numeric := 0; v_laser boolean := false; v_nao_laser boolean := false; v_desc text[] := '{}';
begin
  if array_length(v_cod, 1) is null then
    return jsonb_build_object('ok', false, 'orientacao', 'Informe o código do serviço (entre colchetes no catálogo), ex.: micro_sobrancelha.');
  end if;
  for r in select c.cod, s.* from unnest(v_cod) with ordinality c(cod, n) left join public.servicos s on s.codigo = c.cod and s.ativo order by c.n loop
    if r.nome is null then
      v_err := v_err || 'Código "' || r.cod || '" não existe no catálogo. ';
    elsif not r.agendavel then
      v_err := v_err || r.nome || ' não é agendado por aqui: chame transferir_para_equipe (motivo avaliacao). ';
    else
      v_dur := v_dur + r.duracao_min; v_valor := v_valor + coalesce(r.preco, 0); v_desc := v_desc || r.nome;
      if r.so_laser_day then v_laser := true; else v_nao_laser := true; end if;
    end if;
  end loop;
  if v_err <> '' then return jsonb_build_object('ok', false, 'orientacao', v_err); end if;
  if v_laser and v_nao_laser then
    return jsonb_build_object('ok', false, 'orientacao', 'Serviços de laser só são feitos no Laser Day e não podem ser combinados com outros no mesmo horário. Busque separadamente.');
  end if;
  return jsonb_build_object('ok', true, 'codigos', to_jsonb(v_cod), 'duracao_min', v_dur, 'valor', v_valor,
                            'laser', v_laser, 'descricao', array_to_string(v_desc, ' + '));
end $$;

create or replace function public.lis_horarios(p_lead_id uuid, p_servicos text, p_data text default null, p_turno text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v jsonb; v_dur interval; v_laser boolean; v_ini date; v_fim date; v_dia date; j record; t timestamptz;
  v_min timestamptz; v_max int := coalesce(nullif(public.cfg('max_opcoes_horario'), '')::int, 3);
  v_opcoes jsonb := '[]'; v_qtd int := 0; v_no_dia int; v_ult timestamptz; v_turno text := lower(coalesce(p_turno, ''));
  v_prox_laser date; v_lim int; v_gap interval;
begin
  perform public.lis_exigir_n8n();
  v := public.lis_validar_servicos(p_servicos);
  if not (v->>'ok')::boolean then return v; end if;
  v_dur := make_interval(mins => (v->>'duracao_min')::int);
  v_laser := (v->>'laser')::boolean;
  v_min := now() + make_interval(hours => coalesce(nullif(public.cfg('antecedencia_min_horas'), '')::int, 2));
  -- arredonda para a próxima meia hora
  v_min := date_trunc('hour', v_min) + make_interval(mins => case when extract(minute from v_min) = 0 then 0 when extract(minute from v_min) <= 30 then 30 else 60 end);

  if nullif(p_data, '') is not null then
    begin v_ini := p_data::date; exception when others then
      return jsonb_build_object('ok', false, 'orientacao', 'Data inválida. Use AAAA-MM-DD.'); end;
    v_fim := v_ini;
  else
    v_ini := (now() at time zone 'America/Bahia')::date;
    v_fim := v_ini + coalesce(nullif(public.cfg('janela_agenda_dias'), '')::int, 21);
    if v_laser then v_fim := v_ini + 60; end if;
  end if;

  v_lim := case when nullif(p_data, '') is not null then v_max + 1 else v_max end;
  v_gap := case when nullif(p_data, '') is not null then interval '90 minutes' else interval '3 hours' end;
  v_dia := v_ini;
  while v_dia <= v_fim and v_qtd < v_lim loop
    for j in select * from public.lis_janela_dia(v_dia, v_laser) loop
      if j.vagas is not null and (select count(*) from public.agendamentos a
            where a.status in ('aguardando_sinal','confirmado') and (a.inicio at time zone 'America/Bahia')::date = v_dia) >= j.vagas then
        continue;
      end if;
      v_no_dia := 0; v_ult := null;
      t := greatest(j.abre, v_min);
      while t + v_dur <= j.fecha and v_qtd < v_lim loop
        if (v_turno in ('manha','manhã') and extract(hour from t at time zone 'America/Bahia') >= 12)
           or (v_turno = 'tarde' and extract(hour from t at time zone 'America/Bahia') < 12) then
          t := t + interval '30 minutes'; continue;
        end if;
        if public.lis_slot_livre(t, t + v_dur)
           -- espalha as opções: no máximo 2 por dia (quando não pediu data) com pelo menos 3h entre elas
           and (v_ult is null or t >= v_ult + v_gap) then
          v_opcoes := v_opcoes || jsonb_build_object('inicio', to_char(t at time zone 'America/Bahia', 'YYYY-MM-DD"T"HH24:MI:00-03:00'),
                                                     'legivel', public.lis_legivel(t));
          v_qtd := v_qtd + 1; v_no_dia := v_no_dia + 1; v_ult := t;
          exit when (p_data is null or p_data = '') and v_no_dia >= 2;
        end if;
        t := t + interval '30 minutes';
      end loop;
    end loop;
    v_dia := v_dia + 1;
  end loop;

  if v_qtd = 0 then
    if v_laser then
      select min(data) into v_prox_laser from public.laser_days where data >= (now() at time zone 'America/Bahia')::date;
      return jsonb_build_object('ok', false, 'opcoes', '[]'::jsonb, 'orientacao',
        case when v_prox_laser is null then
          'Ainda não há data definida para o próximo Laser Day. Diga que a Lis faz o Laser Day uma vez por mês, que você vai deixar o nome dela na lista e avisar assim que a data abrir. Chame atualizar_cliente com stage lista_laser_day.'
        else 'O Laser Day de ' || to_char(v_prox_laser, 'DD/MM') || ' está sem vagas. Ofereça deixar o nome na lista para o próximo (atualizar_cliente com stage lista_laser_day).' end);
    end if;
    return jsonb_build_object('ok', false, 'opcoes', '[]'::jsonb, 'orientacao',
      case when p_data is not null and p_data <> '' then 'Não há horário livre nesse dia' || case when v_turno <> '' then ' nesse turno' else '' end || '. Ofereça buscar outro dia (chame buscar_horarios sem data).'
      else 'Não há horários livres nas próximas semanas. Chame transferir_para_equipe (motivo agenda_cheia).' end);
  end if;
  return jsonb_build_object('ok', true, 'servicos', v->>'descricao', 'duracao_min', (v->>'duracao_min')::int,
                            'valor_total', public.lis_brl((v->>'valor')::numeric), 'opcoes', v_opcoes,
                            'orientacao', 'Ofereça estas opções usando o campo legivel. Para agendar, passe o campo inicio exatamente como está.');
end $$;

create or replace function public.lis_agendar(p_lead_id uuid, p_servicos text, p_inicio text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v jsonb; v_ini timestamptz; v_fim timestamptz; v_ok boolean := false; j record; v_lead public.leads;
  v_ag public.agendamentos; v_exige boolean := coalesce(public.cfg('exigir_sinal'), 'false') = 'true';
  v_sinal numeric := nullif(public.cfg('sinal_valor'), '')::numeric; v_existente public.agendamentos;
begin
  perform public.lis_exigir_n8n();
  perform pg_advisory_xact_lock(hashtext('lis_agenda'));
  select * into v_lead from public.leads where id = p_lead_id;
  if v_lead.id is null then return jsonb_build_object('ok', false, 'orientacao', 'Cliente não encontrada.'); end if;

  v := public.lis_validar_servicos(p_servicos);
  if not (v->>'ok')::boolean then return v; end if;
  begin v_ini := p_inicio::timestamptz; exception when others then
    return jsonb_build_object('ok', false, 'orientacao', 'Horário inválido. Use o campo inicio exatamente como veio de buscar_horarios.'); end;
  v_fim := v_ini + make_interval(mins => (v->>'duracao_min')::int);

  if v_ini < now() + make_interval(hours => coalesce(nullif(public.cfg('antecedencia_min_horas'), '')::int, 2)) then
    return jsonb_build_object('ok', false, 'orientacao', 'Esse horário já passou ou está muito em cima. Chame buscar_horarios de novo.');
  end if;

  select * into v_existente from public.agendamentos
   where lead_id = p_lead_id and status in ('aguardando_sinal','confirmado') and inicio > now() order by inicio limit 1;
  if v_existente.id is not null then
    return jsonb_build_object('ok', false, 'orientacao',
      'A cliente já tem ' || v_existente.descricao || ' marcado para ' || public.lis_legivel(v_existente.inicio)
      || '. Se ela quer remarcar ou acrescentar outro serviço, chame transferir_para_equipe (motivo reagendamento).');
  end if;

  for j in select * from public.lis_janela_dia((v_ini at time zone 'America/Bahia')::date, (v->>'laser')::boolean) loop
    if v_ini >= j.abre and v_fim <= j.fecha then v_ok := true; end if;
  end loop;
  if not v_ok then
    return jsonb_build_object('ok', false, 'orientacao', 'Esse horário está fora do expediente. Chame buscar_horarios e ofereça um horário da lista.');
  end if;
  if not public.lis_slot_livre(v_ini, v_fim) then
    return jsonb_build_object('ok', false, 'orientacao', 'Esse horário acabou de ser ocupado. Peça desculpas e chame buscar_horarios de novo.');
  end if;

  insert into public.agendamentos(lead_id, servicos, descricao, inicio, fim, status, valor, sinal_valor, origem)
  values (p_lead_id, array(select jsonb_array_elements_text(v->'codigos')), v->>'descricao', v_ini, v_fim,
          case when v_exige then 'aguardando_sinal' else 'confirmado' end, (v->>'valor')::numeric,
          case when v_exige then v_sinal end, 'ia')
  returning * into v_ag;

  update public.leads set stage = case when v_exige then 'aguardando_sinal' else 'agendado' end,
         procedimento_interesse = coalesce(procedimento_interesse, (v->'codigos')->>0)
   where id = p_lead_id;
  insert into public.lead_events(lead_id, type, actor, data)
  values (p_lead_id, 'agendamento_criado', 'ia', jsonb_build_object('agendamento_id', v_ag.id, 'inicio', v_ini, 'servicos', v->>'descricao'));

  return jsonb_build_object(
    'ok', true, 'agendamento_id', v_ag.id, 'status', v_ag.status, 'quando', public.lis_legivel(v_ini),
    'servicos', v_ag.descricao, 'valor_total', public.lis_brl(v_ag.valor),
    'endereco', nullif(public.cfg('endereco'), ''), 'link_maps', nullif(public.cfg('link_maps'), ''),
    'tolerancia_min', public.cfg('tolerancia_atraso_min'),
    'orientacao', case when v_exige then
        'Pré-reserva feita. Explique que neste período o horário só fica garantido com o sinal de ' || coalesce(public.lis_brl(v_sinal), '(valor do sinal)')
        || ' via Pix (chave: ' || coalesce(nullif(public.cfg('pix_chave'), ''), 'a Lis envia a chave') || '), que o restante é pago no dia, '
        || 'e peça para enviar o comprovante aqui. Política: desistência ou remarcação em até 7 dias após o agendamento tem reembolso; '
        || 'aviso na véspera ou falta não tem reembolso.'
      else 'Agendamento confirmado. Confirme dia, hora e serviço, envie o endereço (se houver), lembre da tolerância de '
        || coalesce(public.cfg('tolerancia_atraso_min'), '10') || ' minutos de atraso e de não levar acompanhante que dependa dela em procedimentos demorados.' end);
end $$;

-- ================================================================ entrada / saída de mensagens
create or replace function public.sdr_inbound(p_phone text, p_whatsapp_name text, p_content text,
                                              p_type text default 'text', p_wa_message_id text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_lead uuid; v_msg uuid; v_dup boolean := false;
begin
  perform public.lis_exigir_n8n();
  insert into public.leads(phone, whatsapp_name) values (p_phone, p_whatsapp_name)
  on conflict (phone) do update set whatsapp_name = coalesce(excluded.whatsapp_name, public.leads.whatsapp_name)
  returning id into v_lead;
  begin
    insert into public.messages(lead_id, direction, sender, type, content, wa_message_id)
    values (v_lead, 'in', 'lead', coalesce(p_type, 'text'), p_content, nullif(p_wa_message_id, ''))
    returning id into v_msg;
  exception when unique_violation then v_dup := true;
  end;
  return jsonb_build_object('duplicate', v_dup, 'lead_id', v_lead, 'message_id', v_msg,
                            'janela_segundos', coalesce(nullif(public.cfg('janela_agrupamento_seg'), '')::int, 15));
end $$;

create or replace function public.sdr_set_content(p_message_id uuid, p_content text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.lis_exigir_n8n();
  update public.messages set content = '[áudio] ' || p_content where id = p_message_id;
end $$;

create or replace function public.sdr_outbound(p_lead_id uuid, p_content text, p_sender text default 'ia', p_type text default 'text')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public.lis_exigir_n8n();
  if p_sender = 'ia' and p_type = 'text' and exists (
      select 1 from (select content from public.messages where lead_id = p_lead_id and sender = 'ia'
                      order by created_at desc limit 6) m
       where lower(regexp_replace(m.content, '\W', '', 'g')) = lower(regexp_replace(p_content, '\W', '', 'g'))) then
    return jsonb_build_object('send', false, 'reason', 'mensagem_repetida');
  end if;
  insert into public.messages(lead_id, direction, sender, type, content)
  values (p_lead_id, 'out', p_sender, p_type, p_content) returning id into v_id;
  return jsonb_build_object('send', true, 'message_id', v_id);
end $$;

create or replace function public.sdr_set_wa_id_by_msg(p_message_id uuid, p_wa_message_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.lis_exigir_n8n();
  if coalesce(p_wa_message_id, '') <> '' then
    update public.messages set wa_message_id = p_wa_message_id where id = p_message_id and wa_message_id is null;
  end if;
exception when unique_violation then null;
end $$;

-- mensagem enviada pelo celular da Lis (fromMe) → registra como equipe e pausa a Laura nessa conversa
create or replace function public.sdr_team_message(p_phone text, p_content text, p_type text, p_wa_message_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_lead uuid;
begin
  perform public.lis_exigir_n8n();
  if exists (select 1 from public.messages where wa_message_id = p_wa_message_id) then
    return jsonb_build_object('ignored', true, 'why', 'ja_registrada');
  end if;
  select id into v_lead from public.leads where phone = p_phone;
  if v_lead is null then return jsonb_build_object('ignored', true, 'why', 'sem_cliente'); end if;
  -- corrida: a Laura acabou de mandar e o id ainda não foi gravado
  if exists (select 1 from public.messages where lead_id = v_lead and sender in ('ia','sistema')
              and created_at > now() - interval '3 minutes'
              and (content = p_content or (p_type <> 'text' and type <> 'text'))) then
    return jsonb_build_object('ignored', true, 'why', 'enviada_pela_ia');
  end if;
  insert into public.messages(lead_id, direction, sender, type, content, wa_message_id)
  values (v_lead, 'out', 'equipe', p_type, p_content, p_wa_message_id);
  if not (select ai_paused from public.leads where id = v_lead) then
    perform public.lis_handoff_interno(v_lead, 'equipe_respondeu', 'A Lis respondeu pelo celular e assumiu a conversa.');
  end if;
  return jsonb_build_object('ignored', false, 'lead_id', v_lead);
end $$;

-- ================================================================ lote para a Laura responder
create or replace function public.sdr_batch(p_lead_id uuid, p_message_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_lead public.leads; v_last_in public.messages; v_prev timestamptz; v_h int; v_ini int; v_fim int; v_teste text;
  v_texto text; v_hist text; v_ag jsonb; v_ult jsonb; v_claim uuid;
begin
  perform public.lis_exigir_n8n();
  select * into v_lead from public.leads where id = p_lead_id;
  if v_lead.id is null then return jsonb_build_object('processar', false, 'motivo', 'sem_cliente'); end if;

  select * into v_last_in from public.messages where lead_id = p_lead_id and direction = 'in' order by created_at desc limit 1;
  if v_last_in.id is null then return jsonb_build_object('processar', false, 'motivo', 'sem_mensagem'); end if;
  if p_message_id is not null and v_last_in.id <> p_message_id then
    return jsonb_build_object('processar', false, 'motivo', 'chegou_mensagem_mais_nova');
  end if;
  if coalesce(public.cfg('ia_ativa'), 'true') <> 'true' then return jsonb_build_object('processar', false, 'motivo', 'ia_desligada'); end if;
  v_teste := regexp_replace(coalesce(public.cfg('numeros_teste'), ''), '[^0-9,]', '', 'g');
  if v_teste <> '' and not (v_lead.phone = any(string_to_array(v_teste, ','))) then
    return jsonb_build_object('processar', false, 'motivo', 'modo_teste');
  end if;
  if v_lead.ai_paused then return jsonb_build_object('processar', false, 'motivo', 'ia_pausada'); end if;
  v_h := extract(hour from now() at time zone 'America/Bahia');
  v_ini := coalesce(nullif(public.cfg('ia_hora_inicio'), '')::int, 8);
  v_fim := coalesce(nullif(public.cfg('ia_hora_fim'), '')::int, 20);
  if v_h < v_ini or v_h >= v_fim then return jsonb_build_object('processar', false, 'motivo', 'fora_do_horario'); end if;

  v_prev := v_lead.ia_processado_ate;
  -- "reserva" o lote (evita duas execuções respondendo a mesma mensagem)
  update public.leads set ia_processado_ate = v_last_in.created_at
   where id = p_lead_id and (ia_processado_ate is null or ia_processado_ate < v_last_in.created_at)
  returning id into v_claim;
  if v_claim is null then return jsonb_build_object('processar', false, 'motivo', 'ja_processado'); end if;

  select string_agg(coalesce(m.content, '[' || m.type || ']'), E'\n' order by m.created_at) into v_texto
    from public.messages m
   where m.lead_id = p_lead_id and m.direction = 'in' and (v_prev is null or m.created_at > v_prev);

  select string_agg(
           to_char(m.created_at at time zone 'America/Bahia', 'DD/MM HH24:MI') || ' ' ||
           case m.sender when 'lead' then 'Cliente' when 'ia' then 'Laura' when 'equipe' then 'Lis (equipe)' else 'Sistema' end
           || ': ' || coalesce(m.content, '[' || m.type || ']'), E'\n' order by m.created_at) into v_hist
    from (select * from public.messages where lead_id = p_lead_id
            and not (direction = 'in' and (v_prev is null or created_at > v_prev))
          order by created_at desc limit 40) m;

  select coalesce(jsonb_agg(jsonb_build_object('servicos', a.descricao, 'quando', public.lis_legivel(a.inicio), 'status', a.status,
                                               'valor', public.lis_brl(a.valor)) order by a.inicio), '[]')
    into v_ag from public.agendamentos a where a.lead_id = p_lead_id and a.status in ('aguardando_sinal','confirmado') and a.inicio > now();
  select jsonb_build_object('servicos', a.descricao, 'quando', to_char(a.inicio at time zone 'America/Bahia', 'DD/MM/YYYY'))
    into v_ult from public.agendamentos a where a.lead_id = p_lead_id and a.status = 'atendido' order by a.inicio desc limit 1;

  return jsonb_build_object(
    'processar', true, 'lead_id', v_lead.id, 'telefone', v_lead.phone,
    'agora', (array['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'])[extract(dow from now() at time zone 'America/Bahia')::int + 1]
             || ', ' || to_char(now() at time zone 'America/Bahia', 'DD/MM/YYYY HH24:MI') || ' (hoje = ' || to_char(now() at time zone 'America/Bahia', 'YYYY-MM-DD') || ')',
    'nome_whatsapp', v_lead.whatsapp_name, 'etapa', v_lead.stage,
    'ficha', jsonb_strip_nulls(jsonb_build_object('nome', v_lead.name, 'aniversario', to_char(v_lead.birthday, 'DD/MM'),
               'procedimento_interesse', v_lead.procedimento_interesse, 'tecnica_interesse', v_lead.tecnica_interesse,
               'turno_preferido', v_lead.turno_preferido, 'origem', nullif(v_lead.source, 'whatsapp')) || v_lead.ficha),
    'agendamentos_futuros', v_ag, 'ultimo_atendimento', v_ult,
    'catalogo', public.lis_catalogo_texto(),
    'studio', jsonb_strip_nulls(jsonb_build_object('endereco', nullif(public.cfg('endereco'), ''), 'link_maps', nullif(public.cfg('link_maps'), ''),
               'instagram', public.cfg('instagram'), 'exigir_sinal', public.cfg('exigir_sinal') = 'true',
               'sinal', public.lis_brl(nullif(public.cfg('sinal_valor'), '')::numeric), 'pix', nullif(public.cfg('pix_chave'), ''),
               'tolerancia_atraso_min', public.cfg('tolerancia_atraso_min'),
               'proximos_laser_days', (select string_agg(to_char(data, 'DD/MM'), ', ' order by data) from public.laser_days
                                        where data >= (now() at time zone 'America/Bahia')::date))),
    'fotos_disponiveis', (select coalesce(jsonb_agg(distinct chave), '[]') from public.midias where ativo),
    'historico', coalesce(v_hist, '(primeira mensagem)'), 'texto', coalesce(v_texto, ''),
    'ja_se_apresentou', exists (select 1 from public.messages where lead_id = p_lead_id and sender = 'ia'),
    'equipe_ja_conversou', exists (select 1 from public.messages where lead_id = p_lead_id and sender = 'equipe'),
    'cliente_antiga', exists (select 1 from public.agendamentos where lead_id = p_lead_id and status = 'atendido'));
end $$;

-- ================================================================ ficha da cliente
create or replace function public.sdr_update_lead(p_lead_id uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.leads; v_b date; v_extra jsonb; v_stage text := p_data->>'stage';
begin
  perform public.lis_exigir_n8n();
  if p_data is null or jsonb_typeof(p_data) <> 'object' then return jsonb_build_object('ok', false); end if;
  begin
    v_b := case when p_data->>'aniversario' ~ '^\d{1,2}/\d{1,2}' then to_date(split_part(p_data->>'aniversario', ' ', 1) ||
                  case when p_data->>'aniversario' ~ '^\d{1,2}/\d{1,2}/\d{4}' then '' else '/2000' end, 'DD/MM/YYYY')
                when p_data->>'aniversario' ~ '^\d{4}-\d{2}-\d{2}' then (p_data->>'aniversario')::date end;
  exception when others then v_b := null; end;
  if v_stage is not null and v_stage not in ('interessada','lista_laser_day','perdido','em_atendimento') then v_stage := null; end if;
  v_extra := p_data - array['nome','name','aniversario','procedimento_interesse','tecnica_interesse','turno_preferido','origem','source','stage','motivo_perda'];
  update public.leads set
    name = coalesce(nullif(p_data->>'nome', ''), nullif(p_data->>'name', ''), name),
    birthday = coalesce(v_b, birthday),
    procedimento_interesse = coalesce(nullif(p_data->>'procedimento_interesse', ''), procedimento_interesse),
    tecnica_interesse = coalesce(nullif(p_data->>'tecnica_interesse', ''), tecnica_interesse),
    turno_preferido = coalesce(nullif(p_data->>'turno_preferido', ''), turno_preferido),
    source = coalesce(nullif(p_data->>'origem', ''), nullif(p_data->>'source', ''), source),
    lost_reason = coalesce(nullif(p_data->>'motivo_perda', ''), lost_reason),
    stage = case when v_stage is not null and stage not in ('agendado','aguardando_sinal') then v_stage else stage end,
    ficha = ficha || coalesce(v_extra, '{}')
  where id = p_lead_id returning * into v;
  return jsonb_build_object('ok', v.id is not null);
end $$;

-- ================================================================ transferência para a Lis
create or replace function public.lis_handoff_interno(p_lead_id uuid, p_reason text, p_summary text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  update public.leads set ai_paused = true, ai_paused_reason = p_reason, ai_paused_at = now() where id = p_lead_id;
  select id into v_id from public.handoffs where lead_id = p_lead_id and status = 'aberto' limit 1;
  if v_id is null then
    insert into public.handoffs(lead_id, reason, summary) values (p_lead_id, p_reason, p_summary) returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.sdr_handoff(p_lead_id uuid, p_reason text, p_summary text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.lis_exigir_n8n();
  return jsonb_build_object('handoff_id', public.lis_handoff_interno(p_lead_id, p_reason, p_summary));
end $$;

create or replace function public.sdr_notify_payload(p_lead_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l public.leads; h public.handoffs;
begin
  perform public.lis_exigir_n8n();
  select * into l from public.leads where id = p_lead_id;
  select * into h from public.handoffs where lead_id = p_lead_id order by opened_at desc limit 1;
  return jsonb_build_object('nome', coalesce(l.name, l.whatsapp_name), 'telefone', l.phone, 'motivo', h.reason, 'resumo', h.summary,
    'procedimento', (select nome from public.servicos where codigo = l.procedimento_interesse),
    'numeros', to_jsonb(array(select x from unnest(string_to_array(regexp_replace(coalesce(public.cfg('numeros_notificacao'), ''), '[^0-9,]', '', 'g'), ',')) x where x <> '')),
    'base_url', rtrim(public.cfg('evolution_base_url'), '/'), 'instancia', public.cfg('evolution_instancia'));
end $$;

create or replace function public.sdr_evo_config() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.lis_exigir_n8n();
  return jsonb_build_object('base_url', rtrim(public.cfg('evolution_base_url'), '/'), 'instancia', public.cfg('evolution_instancia'),
                            'webhook_atendimento', public.cfg('n8n_webhook_atendimento_url'));
end $$;

-- fotos de uma chave (ex.: tecnicas_sobrancelha)
create or replace function public.lis_midias(p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.lis_exigir_n8n();
  return coalesce((select jsonb_agg(jsonb_build_object('url', url, 'tipo', tipo, 'legenda', legenda) order by ordem)
                     from (select * from public.midias where ativo and chave = lower(trim(p_chave)) order by ordem limit 4) m), '[]');
end $$;

-- mensagem enviada pela equipe pelo CRM (o n8n valida o login antes)
create or replace function public.sdr_crm_message(p_lead_id uuid, p_content text, p_user text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_phone text;
begin
  perform public.lis_exigir_n8n();
  select phone into v_phone from public.leads where id = p_lead_id;
  if v_phone is null then return jsonb_build_object('ok', false); end if;
  insert into public.messages(lead_id, direction, sender, content) values (p_lead_id, 'out', 'equipe', p_content) returning id into v_id;
  if not (select ai_paused from public.leads where id = p_lead_id) then
    perform public.lis_handoff_interno(p_lead_id, 'equipe_respondeu', 'Atendimento assumido pelo CRM por ' || coalesce(p_user, 'equipe') || '.');
  end if;
  return jsonb_build_object('ok', true, 'message_id', v_id, 'telefone', v_phone);
end $$;

-- ================================================================ rotinas (a cada 15 min)

-- clientes que escreveram e ainda não tiveram resposta da Laura (fora do horário, depois de a Lis devolver etc.)
create or replace function public.lis_pendentes() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_min int := coalesce(nullif(public.cfg('devolver_ia_apos_min'), '')::int, 0); r record;
begin
  perform public.lis_exigir_n8n();
  -- devolve para a Laura conversas que a Lis assumiu pelo celular e largou há mais de X minutos
  if v_min > 0 then
    for r in select h.lead_id from public.handoffs h join public.leads l on l.id = h.lead_id
              where h.status = 'aberto' and h.reason = 'equipe_respondeu'
                and coalesce(l.last_team_at, h.opened_at) < now() - make_interval(mins => v_min) loop
      update public.handoffs set status = 'devolvido', returned_at = now(), returned_by = 'automatico' where lead_id = r.lead_id and status = 'aberto';
      -- o que a cliente falou enquanto estava com a Lis não precisa de resposta da Laura
      update public.leads set ai_paused = false, ai_paused_reason = null, ai_paused_at = null,
             ia_processado_ate = greatest(coalesce(ia_processado_ate, last_inbound_at), last_inbound_at)
       where id = r.lead_id;
    end loop;
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('lead_id', l.id,
            'message_id', (select m.id from public.messages m where m.lead_id = l.id and m.direction = 'in' order by m.created_at desc limit 1)))
     from public.leads l
    where not l.ai_paused and l.last_inbound_at is not null
      and l.last_inbound_at > coalesce(l.ia_processado_ate, '-infinity')
      and l.last_inbound_at < now() - interval '2 minutes'
      and l.last_inbound_at > now() - interval '3 days'), '[]');
end $$;

-- follow-up de quem parou de responder (dia seguinte, 3 dias, 7 dias, 14 dias), só 8h–20h de seg a sáb
create or replace function public.sdr_followups_payload() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_local timestamp := now() at time zone 'America/Bahia';
begin
  perform public.lis_exigir_n8n();
  if extract(dow from v_local) = 0 or extract(hour from v_local) < 9 or extract(hour from v_local) >= 19
     or coalesce(public.cfg('ia_ativa'), 'true') <> 'true' then return '[]'; end if;
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object(
      'lead_id', l.id, 'telefone', l.phone, 'nome', coalesce(l.name, l.whatsapp_name), 'tentativa', l.followup_count + 1,
      'procedimento', (select nome from public.servicos where codigo = l.procedimento_interesse),
      'foto', (select jsonb_build_object('url', m.url, 'tipo', m.tipo) from public.midias m
                where m.ativo and l.followup_count in (1, 2)
                  and m.chave = (select s.categoria from public.servicos s where s.codigo = l.procedimento_interesse)
                order by m.ordem offset (l.followup_count - 1) limit 1),
      'historico', (select string_agg(case h.sender when 'lead' then 'Cliente' when 'ia' then 'Laura' else 'Lis' end || ': ' || coalesce(h.content, ''), E'\n' order by h.created_at)
                      from (select * from public.messages where lead_id = l.id order by created_at desc limit 12) h)) x
      from public.leads l
     where not l.ai_paused and l.stage in ('em_atendimento','interessada')
       and l.last_outbound_at is not null and l.last_outbound_at > coalesce(l.last_inbound_at, '-infinity')
       and l.followup_count < 4
       and (select sender from public.messages where lead_id = l.id order by created_at desc limit 1) = 'ia'
       and now() >= l.last_outbound_at + case l.followup_count when 0 then interval '20 hours' when 1 then interval '3 days'
                                                               when 2 then interval '7 days' else interval '14 days' end
       and (coalesce(nullif(regexp_replace(coalesce(public.cfg('numeros_teste'), ''), '[^0-9,]', '', 'g'), ''), '') = ''
            or l.phone = any(string_to_array(regexp_replace(public.cfg('numeros_teste'), '[^0-9,]', '', 'g'), ',')))
     limit 20) s), '[]');
end $$;

create or replace function public.sdr_mark_followup(p_lead_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.lis_exigir_n8n();
  update public.leads set followup_count = followup_count + 1 where id = p_lead_id;
  insert into public.lead_events(lead_id, type, actor, data)
  select id, 'followup', 'ia', jsonb_build_object('n', followup_count) from public.leads where id = p_lead_id;
  update public.leads set stage = 'perdido', lost_reason = coalesce(lost_reason, 'sem_resposta') where id = p_lead_id and followup_count >= 4;
end $$;

-- lembretes: véspera do horário, retorno/manutenção e aniversário. Também fecha os atendimentos que já passaram.
create or replace function public.sdr_reminders_payload() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_local timestamp := now() at time zone 'America/Bahia'; v_out jsonb := '[]'; v_end text; v_tol text;
begin
  perform public.lis_exigir_n8n();
  -- horário passou e ninguém marcou falta → atendido
  with a as (update public.agendamentos set status = 'atendido' where status = 'confirmado' and fim < now() - interval '3 hours' returning lead_id)
  update public.leads set stage = 'atendida' where id in (select lead_id from a) and stage in ('agendado','aguardando_sinal');

  if extract(hour from v_local) < 8 or extract(hour from v_local) >= 20 or coalesce(public.cfg('ia_ativa'), 'true') <> 'true' then return '[]'; end if;
  v_end := nullif(public.cfg('endereco'), ''); v_tol := coalesce(public.cfg('tolerancia_atraso_min'), '10');

  -- véspera (ou no mesmo dia, se marcado há pouco tempo não manda)
  select v_out || coalesce(jsonb_agg(jsonb_build_object('tipo', 'lembrete_24h', 'ref', a.id, 'lead_id', a.lead_id, 'telefone', l.phone,
           'texto', 'Oi' || coalesce(', ' || split_part(coalesce(l.name, l.whatsapp_name), ' ', 1), '') || '! Passando para lembrar do seu horário '
             || case when (a.inicio at time zone 'America/Bahia')::date = v_local::date then 'hoje' else 'amanhã' end
             || ', ' || public.lis_legivel(a.inicio) || ', para ' || a.descricao || '.'
             || coalesce(E'\n\nEndereço: ' || v_end, '')
             || E'\n\nTemos tolerância de ' || v_tol || ' minutos de atraso. Posso confirmar sua presença?')), '[]')
    into v_out
    from public.agendamentos a join public.leads l on l.id = a.lead_id
   where a.status = 'confirmado' and a.lembrete_24h_at is null
     and a.inicio between now() + interval '2 hours' and now() + interval '28 hours'
     and a.created_at < a.inicio - interval '12 hours';

  -- retorno / manutenção (cílios ~20 dias, design ~28 dias, retoque da micro ~35 dias, manutenção anual...)
  select v_out || coalesce(jsonb_agg(jsonb_build_object('tipo', 'retorno', 'ref', x.id, 'lead_id', x.lead_id, 'telefone', x.phone,
           'texto', 'Oi' || coalesce(', ' || split_part(x.nome, ' ', 1), '') || ', tudo bem? Aqui é a Laura, do Studio Lis Cazais 😊 '
             || 'Já está chegando a hora do seu ' || lower(x.retorno_nome) || '. Quer que eu veja um horário para você esta semana ou na próxima?')), '[]')
    into v_out
    from (select distinct on (a.lead_id) a.id, a.lead_id, l.phone, coalesce(l.name, l.whatsapp_name) nome, r.nome retorno_nome, s.retorno_servico
            from public.agendamentos a join public.leads l on l.id = a.lead_id
            join public.servicos s on s.codigo = any(a.servicos) and s.retorno_dias is not null
            join public.servicos r on r.codigo = s.retorno_servico
           where a.status = 'atendido' and a.retorno_lembrado_at is null and not l.ai_paused
             and a.inicio + make_interval(days => s.retorno_dias) between now() - interval '20 days' and now()
             and not exists (select 1 from public.agendamentos f where f.lead_id = a.lead_id and f.status in ('confirmado','aguardando_sinal') and f.inicio > now())
             and not exists (select 1 from public.agendamentos n where n.lead_id = a.lead_id and n.inicio > a.inicio and n.status <> 'cancelado')
           order by a.lead_id, a.inicio desc) x;

  -- aniversário (às 9h em diante, 1x por ano)
  if extract(hour from v_local) >= 9 then
    select v_out || coalesce(jsonb_agg(jsonb_build_object('tipo', 'aniversario', 'ref', l.id, 'lead_id', l.id, 'telefone', l.phone,
             'texto', 'Feliz aniversário' || coalesce(', ' || split_part(l.name, ' ', 1), '') || '! 🎉 Toda a equipe do Studio Lis Cazais deseja um ano lindo, cheio de saúde e motivos para sorrir. Um beijo da Lis!')), '[]')
      into v_out
      from public.leads l
     where l.birthday is not null and to_char(l.birthday, 'MMDD') = to_char(v_local, 'MMDD')
       and not exists (select 1 from public.lead_events e where e.lead_id = l.id and e.type = 'aniversario'
                         and e.created_at > now() - interval '300 days');
  end if;

  -- modo teste: só para os números de teste
  if coalesce(regexp_replace(coalesce(public.cfg('numeros_teste'), ''), '[^0-9,]', '', 'g'), '') <> '' then
    select coalesce(jsonb_agg(e), '[]') into v_out from jsonb_array_elements(v_out) e
     where e->>'telefone' = any(string_to_array(regexp_replace(public.cfg('numeros_teste'), '[^0-9,]', '', 'g'), ','));
  end if;
  return v_out;
end $$;

create or replace function public.sdr_mark_reminder(p_ref uuid, p_tipo text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.lis_exigir_n8n();
  if p_tipo = 'lembrete_24h' then
    update public.agendamentos set lembrete_24h_at = now() where id = p_ref;
    insert into public.lead_events(lead_id, type, actor) select lead_id, 'lembrete_agendamento', 'ia' from public.agendamentos where id = p_ref;
  elsif p_tipo = 'retorno' then
    update public.agendamentos set retorno_lembrado_at = now() where id = p_ref;
    insert into public.lead_events(lead_id, type, actor) select lead_id, 'lembrete_retorno', 'ia' from public.agendamentos where id = p_ref;
    -- a cliente volta para o funil de atendimento: a próxima resposta dela vai para a Laura
    update public.leads set stage = 'interessada', followup_count = 0,
           procedimento_interesse = (select s.retorno_servico from public.agendamentos a join public.servicos s on s.codigo = any(a.servicos)
                                      where a.id = p_ref and s.retorno_servico is not null limit 1)
     where id = (select lead_id from public.agendamentos where id = p_ref);
  elsif p_tipo = 'aniversario' then
    insert into public.lead_events(lead_id, type, actor) values (p_ref, 'aniversario', 'ia');
  end if;
end $$;

-- ================================================================ permissões
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_equipe() to authenticated;
grant execute on function public.lis_exigir_n8n() to anon, service_role;
do $$
declare f text;
begin
  foreach f in array array[
    'lis_horarios(uuid,text,text,text)', 'lis_agendar(uuid,text,text)', 'sdr_inbound(text,text,text,text,text)',
    'sdr_set_content(uuid,text)', 'sdr_outbound(uuid,text,text,text)', 'sdr_set_wa_id_by_msg(uuid,text)',
    'sdr_team_message(text,text,text,text)', 'sdr_batch(uuid,uuid)', 'sdr_update_lead(uuid,jsonb)', 'sdr_handoff(uuid,text,text)',
    'sdr_notify_payload(uuid)', 'sdr_evo_config()', 'lis_midias(text)', 'sdr_crm_message(uuid,text,text)', 'lis_pendentes()',
    'sdr_followups_payload()', 'sdr_mark_followup(uuid)', 'sdr_reminders_payload()', 'sdr_mark_reminder(uuid,text)'] loop
    execute format('grant execute on function public.%s to anon, service_role', f);
  end loop;
end $$;
