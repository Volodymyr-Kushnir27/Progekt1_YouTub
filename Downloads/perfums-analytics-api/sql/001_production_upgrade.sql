begin;

alter table if exists public.telegram_imports enable row level security;

-- Upgrade the legacy monthly table before CREATE TABLE IF NOT EXISTS. The
-- latter never adds or renames columns on an already existing table.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='employee_monthly_performance'
      and column_name='days_count'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='employee_monthly_performance'
      and column_name='reported_shifts'
  ) then
    alter table public.employee_monthly_performance rename column days_count to reported_shifts;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='employee_monthly_performance'
      and column_name='completion_rate'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='employee_monthly_performance'
      and column_name='completion_percent'
  ) then
    alter table public.employee_monthly_performance rename column completion_rate to completion_percent;
  end if;
end $$;

create table if not exists public.employee_monthly_performance (
  id bigserial primary key,
  performance_month date not null,
  employee_id bigint not null references public.employees(id),
  department_id bigint references public.departments(id),
  reported_shifts numeric,
  plan_ml numeric,
  sales_ml numeric,
  completion_percent numeric,
  is_final boolean not null default false,
  source_file text,
  source_row text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (performance_month, employee_id, department_id)
);

alter table public.employee_monthly_performance
  add column if not exists department_id bigint references public.departments(id),
  add column if not exists reported_shifts numeric,
  add column if not exists plan_ml numeric,
  add column if not exists sales_ml numeric,
  add column if not exists completion_percent numeric,
  add column if not exists is_final boolean not null default false,
  add column if not exists source_file text,
  add column if not exists source_row text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.employee_status_snapshots (
  id bigserial primary key,
  status_month date not null,
  employee_id bigint not null references public.employees(id),
  status text not null check (status in ('expert','master','seller','needs_review')),
  source_file text,
  created_at timestamptz not null default now(),
  unique (status_month, employee_id)
);

create table if not exists public.admin_action_items (
  id bigserial primary key,
  action_month date not null,
  admin_employee_id bigint references public.employees(id),
  employee_id bigint references public.employees(id),
  department_id bigint references public.departments(id),
  action_text text not null,
  is_active boolean not null default true,
  source_file text,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_action_weekly_updates (
  id bigserial primary key,
  action_item_id bigint not null references public.admin_action_items(id) on delete cascade,
  week_start date not null,
  result_text text,
  completion_percent numeric,
  created_at timestamptz not null default now(),
  unique (action_item_id, week_start)
);

alter table public.employee_monthly_performance enable row level security;
alter table public.employee_status_snapshots enable row level security;
alter table public.admin_action_items enable row level security;
alter table public.admin_action_weekly_updates enable row level security;

revoke all on table public.telegram_imports from anon, authenticated;
revoke all on table public.employee_monthly_performance from anon, authenticated;
revoke all on table public.employee_status_snapshots from anon, authenticated;
revoke all on table public.admin_action_items from anon, authenticated;
revoke all on table public.admin_action_weekly_updates from anon, authenticated;

create index if not exists employee_monthly_performance_month_idx
  on public.employee_monthly_performance (performance_month, employee_id);
create index if not exists employee_status_snapshots_month_idx
  on public.employee_status_snapshots (status_month, status);
create index if not exists admin_action_items_month_idx
  on public.admin_action_items (action_month, admin_employee_id);

commit;
