-- O CRM (role authenticated) precisa de GRANT nas tabelas; o RLS (public.is_equipe()) continua decidindo o que cada usuária vê.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
revoke all on all tables in schema public from anon;
