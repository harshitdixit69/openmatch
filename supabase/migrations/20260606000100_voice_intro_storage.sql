insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'intent-voice-intros',
    'intent-voice-intros',
    true,
    15728640,
    array['audio/m4a', 'audio/mp4', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/aac']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "Voice intros are public" on storage.objects;
create policy "Voice intros are public" on storage.objects
    for select using (bucket_id = 'intent-voice-intros');
drop policy if exists "Users can upload their voice intros" on storage.objects;
create policy "Users can upload their voice intros" on storage.objects
    for insert to authenticated with check (
        bucket_id = 'intent-voice-intros'
        and (storage.foldername(name))[1] = auth.uid()::text
    );
drop policy if exists "Users can update their voice intros" on storage.objects;
create policy "Users can update their voice intros" on storage.objects
    for update to authenticated
    using (
        bucket_id = 'intent-voice-intros'
        and (storage.foldername(name))[1] = auth.uid()::text
    )
    with check (
        bucket_id = 'intent-voice-intros'
        and (storage.foldername(name))[1] = auth.uid()::text
    );
drop policy if exists "Users can delete their voice intros" on storage.objects;
create policy "Users can delete their voice intros" on storage.objects
    for delete to authenticated using (
        bucket_id = 'intent-voice-intros'
        and (storage.foldername(name))[1] = auth.uid()::text
    );
