-- Migration: Trigger to automatically delete match upon user block creation
create or replace function public.on_user_block_delete_match()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Delete the match between blocker and blocked user
  delete from public.matches
  where (user_1_id = new.blocker_id and user_2_id = new.blocked_id)
     or (user_1_id = new.blocked_id and user_2_id = new.blocker_id);
  return new;
end;
$$;

drop trigger if exists tr_user_block_delete_match on public.user_blocks;

create trigger tr_user_block_delete_match
  after insert on public.user_blocks
  for each row
  execute function public.on_user_block_delete_match();
