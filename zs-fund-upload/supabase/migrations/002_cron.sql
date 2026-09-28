create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
select cron.schedule('zs-fund-prices', '* * * * *', $$
  select net.http_get(url := 'https://itbievsyimklwexxuavc.supabase.co/functions/v1/update-prices', timeout_milliseconds := 50000)
$$);
select cron.schedule('zs-fund-snapshot', '55 23 * * *', $$
  select net.http_get(url := 'https://itbievsyimklwexxuavc.supabase.co/functions/v1/update-prices?mode=snapshot', timeout_milliseconds := 50000)
$$);
