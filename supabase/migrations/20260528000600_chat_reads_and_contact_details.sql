alter table public.messages
    add column if not exists read_at timestamp with time zone;
create index if not exists messages_match_id_read_at_idx
    on public.messages (match_id, read_at);
create table if not exists public.profile_contact_details (
    profile_id uuid primary key references public.profiles(id) on delete cascade,
    phone_number text,
    whatsapp_number text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.profile_contact_details enable row level security;
drop policy if exists "Users view their own contact details" on public.profile_contact_details;
create policy "Users view their own contact details" on public.profile_contact_details
    for select using (auth.uid() = profile_id);
drop policy if exists "Users insert their own contact details" on public.profile_contact_details;
create policy "Users insert their own contact details" on public.profile_contact_details
    for insert with check (auth.uid() = profile_id);
drop policy if exists "Users update their own contact details" on public.profile_contact_details;
create policy "Users update their own contact details" on public.profile_contact_details
    for update using (auth.uid() = profile_id)
    with check (auth.uid() = profile_id);
drop policy if exists "Users delete their own contact details" on public.profile_contact_details;
create policy "Users delete their own contact details" on public.profile_contact_details
    for delete using (auth.uid() = profile_id);
drop policy if exists "Unlocked matches can view contact details" on public.profile_contact_details;
create policy "Unlocked matches can view contact details" on public.profile_contact_details
    for select using (
        exists (
            select 1
            from public.matches
            where matches.is_unlocked = true
              and (
                  (matches.user_1_id = auth.uid() and matches.user_2_id = profile_contact_details.profile_id)
                  or
                  (matches.user_2_id = auth.uid() and matches.user_1_id = profile_contact_details.profile_id)
              )
        )
    );
create or replace function public.mark_match_messages_read(target_match_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    updated_count integer := 0;
begin
    if auth.uid() is null then
        raise exception 'Authentication required';
    end if;

    if not exists (
        select 1
        from public.matches
        where matches.id = target_match_id
          and (matches.user_1_id = auth.uid() or matches.user_2_id = auth.uid())
    ) then
        raise exception 'Match not found or access denied';
    end if;

    update public.messages
    set read_at = timezone('utc'::text, now())
    where messages.match_id = target_match_id
      and messages.sender_id <> auth.uid()
      and messages.read_at is null;

    get diagnostics updated_count = row_count;
    return updated_count;
end;
$$;
grant execute on function public.mark_match_messages_read(uuid) to authenticated;
