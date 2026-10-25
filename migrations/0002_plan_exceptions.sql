-- Takrorlanuvchi rejali operatsiyaning bitta sanasi "Bajarildi" deb belgilanganda shu sana prognozdan chiqariladi.
create table if not exists planned_exceptions (
  planned_id bigint not null references planned_transactions(id) on delete cascade,
  date       date not null,
  primary key (planned_id, date)
);
