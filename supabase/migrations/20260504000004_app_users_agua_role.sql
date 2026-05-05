alter table app_users
  add column if not exists agua_role text
    check (agua_role in ('admin', 'operator', 'collector', 'viewer'));
