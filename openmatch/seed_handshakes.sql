-- Seed matches
insert into public.matches (user_1_id, user_2_id, status)
values 
  (least('8e4ecc6a-02dc-4d7f-ab8f-07dfa2847e22', '2d7bbeeb-ab0d-4a9f-988c-9c93a0f4cb4a')::uuid, 
   greatest('8e4ecc6a-02dc-4d7f-ab8f-07dfa2847e22', '2d7bbeeb-ab0d-4a9f-988c-9c93a0f4cb4a')::uuid, 
   'connected'),
  (least('8e4ecc6a-02dc-4d7f-ab8f-07dfa2847e22', 'f02e3096-ca47-4067-af87-d6b6a342b090')::uuid, 
   greatest('8e4ecc6a-02dc-4d7f-ab8f-07dfa2847e22', 'f02e3096-ca47-4067-af87-d6b6a342b090')::uuid, 
   'pending')
on conflict (user_1_id, user_2_id) do update set status = excluded.status;

-- Seed interest requests
insert into public.interest_requests (sender_id, receiver_id, status, reason_id, personalized_reason)
values 
  ('8e4ecc6a-02dc-4d7f-ab8f-07dfa2847e22'::uuid, '2d7bbeeb-ab0d-4a9f-988c-9c93a0f4cb4a'::uuid, 'accepted', 'custom', 'Elite concierge match by Elizabeth.'),
  ('8e4ecc6a-02dc-4d7f-ab8f-07dfa2847e22'::uuid, 'f02e3096-ca47-4067-af87-d6b6a342b090'::uuid, 'sent', 'custom', 'Elite concierge match by Elizabeth.')
on conflict do nothing;
