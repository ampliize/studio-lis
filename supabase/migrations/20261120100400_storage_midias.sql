-- Bucket público das fotos/vídeos que a Laura envia (upload só pela equipe logada)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('midias', 'midias', true, 52428800, array['image/jpeg','image/png','image/webp','image/heic','video/mp4','video/quicktime'])
on conflict (id) do nothing;
create policy midias_equipe_insert on storage.objects for insert to authenticated with check (bucket_id = 'midias' and public.is_equipe());
create policy midias_equipe_update on storage.objects for update to authenticated using (bucket_id = 'midias' and public.is_equipe());
create policy midias_equipe_delete on storage.objects for delete to authenticated using (bucket_id = 'midias' and public.is_equipe());
