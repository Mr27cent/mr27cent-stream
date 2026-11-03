-- ═══════════════════════════════════════════════════════════════════════════
--  Herden-Karten: Zuschau-Pack – alle 2 Stunden Zuschauzeit ein Gratis-Pack
--  (cards_config.watch_pack_minutes, 0 = aus). Gezählt wird die Gesamtzeit
--  ab Start; das Pack landet bei den ungeöffneten Packs.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.cards_config add column watch_pack_minutes int not null default 120;
alter table public.cards_users add column watch_packs int not null default 0;  -- schon vergebene Zuschau-Packs

alter table public.cards_packs drop constraint cards_packs_source_check;
alter table public.cards_packs add constraint cards_packs_source_check
  check (source in ('starter', 'weekly', 'sub', 'points', 'admin', 'watch'));

create or replace function public.cards_add_watch(p_viewers jsonb, p_minutes int default 5) returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  v_week date := cards_week_start();
  v_launched boolean := now() >= (select launch_at from cards_config where id = 1);
  v_every int := (select watch_pack_minutes from cards_config where id = 1);
  v record;
  u cards_users;
  v_due int;
  n int := 0;
begin
  for v in
    select x.id, lower(x.login) login, x.name
    from jsonb_to_recordset(p_viewers) as x(id text, login text, name text)
    where x.id is not null and x.login is not null
      and lower(x.login) not in (select login from cards_ignored)
  loop
    if not v_launched and not exists (select 1 from cards_users where twitch_id = v.id and is_tester) then
      continue;
    end if;
    perform cards_touch_user(v.id, v.login, v.name);
    update cards_users set
      total_minutes = total_minutes + p_minutes,
      week_minutes = case when week_start = v_week then week_minutes + p_minutes else p_minutes end,
      week_start = v_week
    where twitch_id = v.id
    returning * into u;

    -- Zuschau-Pack: für jede volle Zeitspanne genau ein Pack
    if v_every > 0 then
      v_due := u.total_minutes / v_every - u.watch_packs;
      if v_due > 0 then
        insert into cards_packs (twitch_id, source) select v.id, 'watch' from generate_series(1, v_due);
        update cards_users set watch_packs = watch_packs + v_due where twitch_id = v.id;
      end if;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.cards_add_watch(jsonb, int) from public, anon, authenticated;

-- Startinfo für die Webseite um die Zuschau-Pack-Spanne ergänzen
create or replace function public.cards_public_info() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'launch_at', c.launch_at,
    'shiny_factor', c.shiny_factor,
    'packs_per_stream', c.points_packs_per_stream,
    'price', c.points_price,
    'watch_pack_minutes', c.watch_pack_minutes,
    'total', (select count(*) from cards_catalog where series = 1),
    'rarities', (select jsonb_agg(jsonb_build_object('code', code, 'rank', rank, 'name', name, 'count', card_count) order by rank)
                 from cards_rarities),
    'stages', (select jsonb_agg(jsonb_build_object('stage', stage, 'minutes', min_minutes, 'name', name) order by stage)
               from cards_stages),
    'collectors', (select count(distinct i.twitch_id) from cards_inventory i
                   join cards_users u on u.twitch_id = i.twitch_id where i.qty > 0 and not u.hidden))
  from cards_config c where c.id = 1
$$;

-- Konto-Info: Minuten bis zum nächsten Zuschau-Pack
create or replace function public.cards_web_me() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id text := cards_auth_user();
  cfg cards_config;
  u cards_users;
  v_week date := cards_week_start();
begin
  select * into cfg from cards_config where id = 1;
  select * into u from cards_users where twitch_id = v_id;
  return cards_status(v_id) || jsonb_build_object(
    'twitch_id', v_id,
    'open', cards_is_open(v_id),
    'launch_at', cfg.launch_at,
    'weekly_min_minutes', cfg.weekly_min_minutes,
    'weekly_claimed', exists (select 1 from cards_weekly_claims where twitch_id = v_id and week_start = v_week and kind = 'free'),
    'next_week', v_week + 7,
    'watch_pack_minutes', cfg.watch_pack_minutes,
    'next_watch_pack', case when cfg.watch_pack_minutes > 0
                         then cfg.watch_pack_minutes - u.total_minutes % cfg.watch_pack_minutes end,
    'trades_today', cards_trades_today(v_id),
    'trades_per_day', cfg.trades_per_day,
    'incoming_trades', (select count(*) from cards_trades
                        where to_id = v_id and status = 'pending' and expires_at >= now()),
    'packs', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'source', source) order by id)
                       from cards_packs where twitch_id = v_id and opened_at is null), '[]'));
end $$;

revoke all on function public.cards_web_me() from public, anon;
grant execute on function public.cards_web_me() to authenticated;
grant execute on function public.cards_public_info() to anon, authenticated;
