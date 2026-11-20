-- Corrige a concordância do lembrete de retorno ("já está na época de: Manutenção de cílios")
do $$
declare d text;
begin
  select pg_get_functiondef('public.sdr_reminders_payload()'::regprocedure) into d;
  d := replace(d, $q$'Já está chegando a hora do seu ' || lower(x.retorno_nome) || '. Quer que eu veja um horário para você esta semana ou na próxima?'$q$,
                  $q$'Já está chegando a época de fazer: ' || x.retorno_nome || '. Quer que eu veja um horário para você esta semana ou na próxima?'$q$);
  execute d;
end $$;
