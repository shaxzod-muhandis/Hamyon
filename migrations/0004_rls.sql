-- Barcha jadvallarda RLS yoqiladi, siyosatsiz. Ma'lumotga faqat server (postgres roli, to'g'ridan-to'g'ri ulanish) kira oladi.
-- Supabase'ning ochiq Data API (anon / authenticated kalitlari) moliyaviy ma'lumotni o'qiy olmasligi uchun.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon;
    revoke all on all sequences in schema public from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema public from authenticated;
    revoke all on all sequences in schema public from authenticated;
  end if;
end $$;
