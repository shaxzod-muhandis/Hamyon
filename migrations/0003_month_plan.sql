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
