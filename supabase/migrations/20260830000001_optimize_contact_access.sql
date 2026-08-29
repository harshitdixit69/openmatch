-- Keep contact-access authorization and retrieval in one database round trip.
create or replace function public.get_contact_details_if_unlocked(target_profile_id uuid)
returns table (
    profile_id uuid,
    phone_number text,
    whatsapp_number text
)
language sql
stable
security definer
set search_path = public
as $$
    select c.profile_id, c.phone_number, c.whatsapp_number
    from public.profile_contact_details c
    where c.profile_id = target_profile_id
      and auth.uid() is not null
      and (
          auth.uid() = c.profile_id
          or (
              not exists (
                  select 1
                  from public.user_blocks b
                  where (b.blocker_id = auth.uid() and b.blocked_id = c.profile_id)
                     or (b.blocker_id = c.profile_id and b.blocked_id = auth.uid())
              )
              and exists (
                  select 1
                  from public.matches m
                  where m.is_unlocked = true
                    and (
                        (m.user_1_id = auth.uid() and m.user_2_id = c.profile_id)
                        or (m.user_1_id = c.profile_id and m.user_2_id = auth.uid())
                    )
              )
          )
      )
    limit 1;
$$;

revoke all on function public.get_contact_details_if_unlocked(uuid) from public;
grant execute on function public.get_contact_details_if_unlocked(uuid) to authenticated;

create index if not exists user_blocks_blocked_blocker_idx
    on public.user_blocks (blocked_id, blocker_id);

create index if not exists matches_user_1_user_2_unlocked_idx
    on public.matches (user_1_id, user_2_id)
    where is_unlocked = true;

create index if not exists matches_user_2_user_1_unlocked_idx
    on public.matches (user_2_id, user_1_id)
    where is_unlocked = true;
