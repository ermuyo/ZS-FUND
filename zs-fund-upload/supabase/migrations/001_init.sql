-- ZS FUND · initial schema
-- Roles: the GP is whoever logs in with settings.gp_email. An LP is whoever logs in with accounts.lp_email.
-- All access rules live in row-level security, so an LP can never read another account, carry terms or settings.

create extension if not exists pgcrypto;

-- ---------- settings (single row) ----------
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  gp_email text not null,
  default_modes jsonb not null default '{"stock":"live","etf":"live","crypto":"live"}'::jsonb
);
insert into public.settings (id, gp_email) values (1, 'hequn360@gmail.com') on conflict (id) do nothing;

create or replace function public.is_gp() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from settings where lower(gp_email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

-- ---------- accounts ----------
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('gp', 'lp')),
  lp_email text,
  since date not null default current_date,
  net_contribution numeric not null default 0,           -- USD, maintained by trigger on cashflows
  created_at timestamptz not null default now()
);
create unique index if not exists accounts_lp_email_uq on public.accounts (lower(lp_email)) where lp_email is not null;

-- kept in a private schema so it is usable by RLS policies but never exposed through the REST API
create schema if not exists private;
grant usage on schema private to authenticated;
create or replace function private.my_account_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.accounts where lp_email is not null and lower(lp_email) = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- carry terms are GP-only (kept out of accounts so LPs cannot read them)
create table if not exists public.account_terms (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  carry_rate numeric not null default 0.2 check (carry_rate >= 0 and carry_rate <= 1)
);

insert into public.accounts (name, type) select 'hank 自有资金', 'gp'
where not exists (select 1 from public.accounts where type = 'gp');

-- ---------- instruments & prices ----------
create table if not exists public.instruments (
  id uuid primary key default gen_random_uuid(),
  symbol text not null unique,                             -- BTC, 0700.HK, 600519.SH, AAPL, USD, custom:xxxx
  name text not null,
  class text not null check (class in ('stock', 'etf', 'crypto', 'cash', 'alt')),
  market text,                                             -- CRYPTO / HK / US / CN / CASH / OTHER
  ccy text not null,
  unit text,
  price_mode text not null default 'live' check (price_mode in ('live', 'manual', 'cash')),
  created_at timestamptz not null default now()
);

create table if not exists public.prices (
  instrument_id uuid primary key references public.instruments(id) on delete cascade,
  price numeric not null,
  prev_close numeric,
  source text,
  delayed boolean not null default false,
  as_of timestamptz not null default now()
);

create table if not exists public.fx (
  ccy text primary key,
  usd_per_unit numeric not null,
  as_of timestamptz not null default now()
);
insert into public.fx (ccy, usd_per_unit) values ('USD', 1), ('HKD', 0.1282), ('CNY', 0.1404), ('JPY', 0.00676), ('EUR', 1.17)
on conflict (ccy) do nothing;

insert into public.instruments (symbol, name, class, market, ccy, unit, price_mode) values
  ('USD', '美元现金', 'cash', 'CASH', 'USD', '', 'cash'),
  ('HKD', '港币现金', 'cash', 'CASH', 'HKD', '', 'cash'),
  ('CNY', '人民币存款', 'cash', 'CASH', 'CNY', '', 'cash')
on conflict (symbol) do nothing;

-- ---------- holdings & cash flows ----------
create table if not exists public.holdings (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  instrument_id uuid not null references public.instruments(id),
  qty numeric not null check (qty >= 0),
  avg_cost numeric not null default 0,                     -- per unit, in instrument currency
  updated_at timestamptz not null default now(),
  unique (account_id, instrument_id)
);

create index if not exists holdings_instrument_idx on public.holdings (instrument_id);

create table if not exists public.cashflows (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  date date not null default current_date,
  kind text not null check (kind in ('deposit', 'withdrawal', 'transfer_in')),
  amount_usd numeric not null check (amount_usd > 0),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists cashflows_account_idx on public.cashflows (account_id);

create or replace function public.apply_cashflow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update accounts set net_contribution = net_contribution + case when new.kind = 'withdrawal' then -new.amount_usd else new.amount_usd end
    where id = new.account_id;
    return new;
  elsif tg_op = 'DELETE' then
    update accounts set net_contribution = net_contribution - case when old.kind = 'withdrawal' then -old.amount_usd else old.amount_usd end
    where id = old.account_id;
    return old;
  end if;
  return null;
end $$;
drop trigger if exists cashflows_apply on public.cashflows;
create trigger cashflows_apply after insert or delete on public.cashflows for each row execute function public.apply_cashflow();

create table if not exists public.nav_daily (
  account_id uuid not null references public.accounts(id) on delete cascade,
  date date not null,
  nav_usd numeric not null,
  contribution_usd numeric not null,
  primary key (account_id, date)
);

-- ---------- row-level security ----------
alter table public.settings      enable row level security;
alter table public.accounts      enable row level security;
alter table public.account_terms enable row level security;
alter table public.instruments   enable row level security;
alter table public.prices        enable row level security;
alter table public.fx            enable row level security;
alter table public.holdings      enable row level security;
alter table public.cashflows     enable row level security;
alter table public.nav_daily     enable row level security;

create policy settings_gp on public.settings for all to authenticated using (public.is_gp()) with check (public.is_gp());
create policy terms_gp on public.account_terms for all to authenticated using (public.is_gp()) with check (public.is_gp());
create policy accounts_read on public.accounts for select to authenticated using (public.is_gp() or id in (select private.my_account_ids()));
create policy accounts_ins on public.accounts for insert to authenticated with check (public.is_gp());
create policy accounts_upd on public.accounts for update to authenticated using (public.is_gp()) with check (public.is_gp());
create policy accounts_del on public.accounts for delete to authenticated using (public.is_gp());
create policy instruments_read on public.instruments for select to authenticated using (true);
create policy instruments_ins on public.instruments for insert to authenticated with check (public.is_gp());
create policy instruments_upd on public.instruments for update to authenticated using (public.is_gp()) with check (public.is_gp());
create policy prices_read on public.prices for select to authenticated using (true);
create policy prices_ins on public.prices for insert to authenticated with check (public.is_gp());
create policy prices_upd on public.prices for update to authenticated using (public.is_gp()) with check (public.is_gp());
create policy fx_read on public.fx for select to authenticated using (true);
create policy holdings_read on public.holdings for select to authenticated using (public.is_gp() or account_id in (select private.my_account_ids()));
create policy holdings_ins on public.holdings for insert to authenticated with check (public.is_gp());
create policy holdings_upd on public.holdings for update to authenticated using (public.is_gp()) with check (public.is_gp());
create policy holdings_del on public.holdings for delete to authenticated using (public.is_gp());
create policy cashflows_read on public.cashflows for select to authenticated using (public.is_gp() or account_id in (select private.my_account_ids()));
create policy cashflows_ins on public.cashflows for insert to authenticated with check (public.is_gp());
create policy cashflows_del on public.cashflows for delete to authenticated using (public.is_gp());
create policy nav_read on public.nav_daily for select to authenticated using (public.is_gp() or account_id in (select private.my_account_ids()));

grant execute on function public.is_gp() to authenticated;

-- ---------- realtime ----------
alter publication supabase_realtime add table public.accounts, public.account_terms, public.instruments, public.prices, public.fx, public.holdings, public.cashflows;

-- trigger/helper functions are not meant to be called directly by clients
revoke execute on function public.apply_cashflow() from public, anon, authenticated;
revoke execute on function private.my_account_ids() from public, anon;
revoke execute on function public.is_gp() from public, anon;
-- my_account_ids is only used inside RLS policies; clients never call it.
