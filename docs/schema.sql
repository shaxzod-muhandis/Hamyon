-- Hamyon: to'liq sxema (avtomatik yaratilgan: npm run db:sql). Supabase SQL Editor'da bir marta ishga tushiring.

begin;

-- ═══ 0001_init.sql ═══
-- Hamyon — boshlang'ich sxema.
-- Summalar butun son: UZS — so'm, USD — sent (minor unit).

create table if not exists users (
  id             bigserial primary key,
  tg_id          bigint unique not null,
  chat_id        bigint,
  first_name     text,
  username       text,
  tz             text not null default 'Asia/Tashkent',
  theme          text not null default 'system' check (theme in ('light','dark','system')),
  safe_threshold bigint not null default 1000000,
  usd_rate       bigint not null default 12700,
  last_account_id bigint,
  created_at     timestamptz not null default now()
);

create table if not exists accounts (
  id              bigserial primary key,
  user_id         bigint not null references users(id) on delete cascade,
  name            text not null,
  short_name      text,
  type            text not null check (type in ('cash','card','savings','currency','bank')),
  currency        text not null default 'UZS',
  initial_balance bigint not null default 0,
  is_liquid       boolean not null default true,
  archived        boolean not null default false,
  sort            int not null default 0,
  created_at      timestamptz not null default now()
);
create unique index if not exists accounts_user_name on accounts (user_id, lower(name)) where not archived;

create table if not exists categories (
  id         bigserial primary key,
  user_id    bigint not null references users(id) on delete cascade,
  kind       text not null check (kind in ('expense','income')),
  name       text not null,
  emoji      text not null default '📦',
  color      text not null default '#8a93a0',
  keywords   text[] not null default '{}',
  is_fixed   boolean not null default false,   -- doimiy to'lov (ijara kabi): budjetda taxmin hisoblanmaydi
  system_key text,                             -- debt_payment | debt_return | debt_given | debt_taken
  archived   boolean not null default false,
  sort       int not null default 0
);
create unique index if not exists categories_user_kind_name on categories (user_id, kind, lower(name)) where not archived;

create table if not exists transactions (
  id            bigserial primary key,
  user_id       bigint not null references users(id) on delete cascade,
  kind          text not null check (kind in ('expense','income','transfer')),
  amount        bigint not null check (amount > 0),
  account_id    bigint not null references accounts(id),
  to_account_id bigint references accounts(id),
  to_amount     bigint,                        -- valyutalar orasidagi o'tkazmada qabul qilingan summa
  category_id   bigint references categories(id),
  note          text,
  occurred_at   timestamptz not null default now(),
  source        text not null default 'bot' check (source in ('bot','web','system')),
  idem_key      text,
  debt_id       bigint,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  check (kind <> 'transfer' or (to_account_id is not null and to_account_id <> account_id))
);
create unique index if not exists tx_idem on transactions (user_id, idem_key) where idem_key is not null;
create index if not exists tx_user_time on transactions (user_id, occurred_at desc) where deleted_at is null;
create index if not exists tx_account on transactions (account_id) where deleted_at is null;

create table if not exists budget_limits (
  user_id      bigint not null references users(id) on delete cascade,
  category_id  bigint not null references categories(id) on delete cascade,
  limit_amount bigint not null check (limit_amount > 0),
  primary key (user_id, category_id)
);

create table if not exists debts (
  id              bigserial primary key,
  user_id         bigint not null references users(id) on delete cascade,
  direction       text not null check (direction in ('payable','receivable')),
  who             text not null,
  principal       bigint not null check (principal > 0),
  account_id      bigint references accounts(id),
  start_date      date not null default current_date,
  due_date        date,
  interest_pct    numeric,
  monthly_payment bigint,
  pay_day         int check (pay_day between 1 and 31),
  note            text,
  closed_at       timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists debt_payments (
  id             bigserial primary key,
  debt_id        bigint not null references debts(id) on delete cascade,
  amount         bigint not null check (amount > 0),
  account_id     bigint not null references accounts(id),
  paid_at        timestamptz not null default now(),
  transaction_id bigint references transactions(id)
);

-- Rejali va takrorlanuvchi operatsiyalar (maosh, ijara...). Prognoz shu jadvaldan.
create table if not exists planned_transactions (
  id                   bigserial primary key,
  user_id              bigint not null references users(id) on delete cascade,
  kind                 text not null check (kind in ('expense','income')),
  name                 text not null,
  amount               bigint not null check (amount > 0),
  category_id          bigint references categories(id),
  account_id           bigint references accounts(id),
  start_date           date not null,
  recurrence           text not null default 'monthly' check (recurrence in ('none','daily','weekly','monthly','yearly')),
  include_in_forecast  boolean not null default true,
  is_salary            boolean not null default false,
  active               boolean not null default true,
  created_at           timestamptz not null default now()
);

create table if not exists reminders (
  user_id  bigint not null references users(id) on delete cascade,
  kind     text not null,
  enabled  boolean not null,
  at_time  text,                       -- 'HH:MM' foydalanuvchi vaqt zonasida
  primary key (user_id, kind)
);

-- Bir eslatma bir davr uchun faqat bir marta yuborilishi uchun
create table if not exists reminder_log (
  user_id    bigint not null references users(id) on delete cascade,
  kind       text not null,
  period_key text not null,
  sent_at    timestamptz not null default now(),
  primary key (user_id, kind, period_key)
);

-- Serverless: suhbat holati xotirada emas, bazada
create table if not exists bot_state (
  tg_id      bigint primary key,
  state      text,
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- Telegram bir update'ni qayta yuborsa, ikki marta ishlamaslik uchun
create table if not exists processed_updates (
  update_id  bigint primary key,
  created_at timestamptz not null default now()
);

create table if not exists notification_log (
  id         bigserial primary key,
  chat_id    text,
  message    text,
  status     text,
  error      text,
  created_at timestamptz not null default now()
);

create table if not exists schema_migrations (
  name       text primary key,
  applied_at timestamptz not null default now()
);

-- ═══ 0002_plan_exceptions.sql ═══
-- Takrorlanuvchi rejali operatsiyaning bitta sanasi "Bajarildi" deb belgilanganda shu sana prognozdan chiqariladi.
create table if not exists planned_exceptions (
  planned_id bigint not null references planned_transactions(id) on delete cascade,
  date       date not null,
  primary key (planned_id, date)
);

-- ═══ 0003_month_plan.sql ═══
-- Keyingi oy rejasi: foydalanuvchi pulni nimalarga ajratmoqchi (muhim xarajatlar va jamg'arma/maqsadlar).
create table if not exists month_plan_items (
  id          bigserial primary key,
  user_id     bigint not null references users(id) on delete cascade,
  month       date not null,                 -- oyning 1-kuni
  title       text not null,
  amount      bigint not null check (amount > 0),
  kind        text not null check (kind in ('spend','save')),
  important   boolean not null default true,
  category_id bigint references categories(id) on delete set null,
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists month_plan_user_month on month_plan_items (user_id, month);

-- ═══ 0004_rls.sql ═══
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

insert into schema_migrations (name) values
  ('0001_init.sql'),
  ('0002_plan_exceptions.sql'),
  ('0003_month_plan.sql'),
  ('0004_rls.sql')
on conflict do nothing;

commit;
