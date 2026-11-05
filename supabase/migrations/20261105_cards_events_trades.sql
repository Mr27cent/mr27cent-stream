-- Herden-Karten: Platzhalter weg, Herde wächst laufend, Event-Karten, Tauschen ohne Duplikat-Pflicht
-- Stand 05.11.2026

-- ── Platzhalter entfernen (nur Testdaten des Testers hängen daran) ───────────
delete from cards_inventory     where card_id in (select id from cards_catalog where name like 'Platzhalter%');
delete from cards_pulls         where card_id in (select id from cards_catalog where name like 'Platzhalter%');
delete from cards_display       where card_id in (select id from cards_catalog where name like 'Platzhalter%');
delete from cards_overlay_queue where card_id in (select id from cards_catalog where name like 'Platzhalter%');
delete from cards_upgrades      where card_id in (select id from cards_catalog where name like 'Platzhalter%');
delete from cards_trades        where offer_card in (select id from cards_catalog where name like 'Platzhalter%')
                                   or want_card in (select id from cards_catalog where name like 'Platzhalter%');
delete from cards_catalog       where name like 'Platzhalter%';

-- ── Kartenarten: person, item, event ────────────────────────────────────────
alter table cards_catalog drop constraint if exists cards_catalog_kind_check;
alter table cards_catalog add constraint cards_catalog_kind_check check (kind in ('person', 'item', 'event'));
alter table cards_catalog add column if not exists tradable boolean not null default true;

-- Karte anlegen oder ändern. Neue Nummer = neue Karte (z. B. neues Herdenmitglied).
create or replace function cards_admin_set_card(p_number int, p_kind text, p_name text,
  p_login text default null, p_image text default null, p_flavor text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id text := 'S1-' || lpad(p_number::text, 3, '0');
begin
  if p_kind not in ('person', 'item', 'event') then raise exception 'kind muss person, item oder event sein'; end if;
  insert into cards_catalog (id, series, number, name, kind, in_packs, tradable)
  values (v_id, 1, p_number, coalesce(nullif(trim(p_name), ''), v_id), p_kind, p_kind <> 'event', p_kind <> 'event')
  on conflict (id) do nothing;
  update cards_catalog set
    kind = p_kind,
    name = coalesce(nullif(trim(p_name), ''), name),
    twitch_login = case when p_kind = 'person' then lower(ltrim(trim(p_login), '@')) end,
    twitch_id = case when p_kind = 'person' and lower(ltrim(trim(p_login), '@')) is not distinct from twitch_login then twitch_id end,
    avatar = case when p_kind = 'person' and lower(ltrim(trim(p_login), '@')) is not distinct from twitch_login then avatar end,
    avatar_checked_at = null,
    image = nullif(trim(p_image), ''),
    flavor = p_flavor,
    in_packs = p_kind <> 'event',
    tradable = p_kind <> 'event'
  where id = v_id;
  return jsonb_build_object('ok', true, 'card', v_id);
end $$;

-- Nächste freie Nummer für ein neues Herdenmitglied (Event-Karten liegen ab 900)
create or replace function cards_admin_add_person(p_login text, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_login text := lower(ltrim(trim(p_login), '@')); v_nr int;
begin
  if exists (select 1 from cards_catalog where kind = 'person' and twitch_login = v_login) then
    return jsonb_build_object('ok', false, 'reason', 'schon_da',
      'card', (select id from cards_catalog where kind = 'person' and twitch_login = v_login));
  end if;
  select coalesce(max(number), 0) + 1 into v_nr from cards_catalog where series = 1 and number < 900;
  return cards_admin_set_card(v_nr, 'person', coalesce(nullif(trim(p_name), ''), v_login), v_login, null, null);
end $$;

-- ── Event-Karten ────────────────────────────────────────────────────────────
-- Wer in einem Event-Stream genug Minuten dabei ist, bekommt die Karte automatisch
-- (zufällige Seltenheit nach den normalen Chancen seiner Gazellen-Stufe, Shiny-Chance wie im Pack).
create table if not exists cards_events (
  id text primary key,
  card_id text not null references cards_catalog,
  name text not null,
  description text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,                -- null = endet mit dem ersten Stream (first_stream_only)
  first_stream_only boolean not null default true,
  stream_id text,                     -- wird beim ersten Stream ab starts_at festgehalten
  min_minutes int not null default 30
);
create table if not exists cards_event_watch (
  event_id text not null references cards_events on delete cascade,
  twitch_id text not null references cards_users,
  minutes int not null default 0,
  granted_at timestamptz,
  rarity text references cards_rarities(code),
  shiny boolean,
  primary key (event_id, twitch_id)
);
alter table cards_events enable row level security;
alter table cards_event_watch enable row level security;

select cards_admin_set_card(901, 'event', 'Erster Stream 2027', null, 'img/karten/e901.jpg',
  'Dabei beim allerersten Stream 2027. Wer diese Karte hat, war von Anfang an da.');
insert into cards_events (id, card_id, name, description, starts_at, min_minutes)
values ('stream1-2027', 'S1-901', 'Der 1. Stream 2027',
        'Sei beim ersten Stream 2027 mindestens 30 Minuten dabei – dann bekommst du diese Karte automatisch.',
        '2027-01-01 00:00:00+01', 30)
on conflict (id) do update set card_id = excluded.card_id, name = excluded.name, description = excluded.description,
  starts_at = excluded.starts_at, min_minutes = excluded.min_minutes;

create or replace function cards_event_tick(p_id text, p_minutes int, p_stream_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  e cards_events;
  w cards_event_watch;
  u cards_users;
  cfg cards_config;
  v_rar text;
  v_shiny boolean;
begin
  for e in select * from cards_events where now() >= starts_at and (ends_at is null or now() < ends_at) for update loop
    if e.first_stream_only then
      if p_stream_id is null then continue; end if;
      if e.stream_id is null then
        update cards_events set stream_id = p_stream_id where id = e.id;
        e.stream_id := p_stream_id;
      elsif e.stream_id <> p_stream_id then
        update cards_events set ends_at = now() where id = e.id;   -- erster Stream ist vorbei
        continue;
      end if;
    end if;

    insert into cards_event_watch (event_id, twitch_id, minutes) values (e.id, p_id, p_minutes)
    on conflict (event_id, twitch_id) do update set minutes = cards_event_watch.minutes + p_minutes
    returning * into w;

    if w.granted_at is null and w.minutes >= e.min_minutes then
      select * into cfg from cards_config where id = 1;
      select * into u from cards_users where twitch_id = p_id;
      v_rar := cards_pick_rarity(cards_stage(u.total_minutes), 1);
      v_shiny := cards_rand() < cfg.shiny_factor;
      insert into cards_inventory (twitch_id, card_id, rarity, shiny, qty) values (p_id, e.card_id, v_rar, v_shiny, 1)
      on conflict (twitch_id, card_id, rarity, shiny) do update set qty = cards_inventory.qty + 1, last_at = now();
      update cards_event_watch set granted_at = now(), rarity = v_rar, shiny = v_shiny
      where event_id = e.id and twitch_id = p_id;
      if v_shiny or cards_rank(v_rar) >= cfg.alert_min_rank then
        insert into cards_overlay_queue (twitch_id, display_name, card_id, rarity, shiny)
        values (p_id, u.display_name, e.card_id, v_rar, v_shiny);
      end if;
    end if;
  end loop;
end $$;

-- Zuschauzeit: jetzt mit Stream-ID (für Event-Karten). Ohne Stream-ID läuft alles wie bisher.
drop function if exists public.cards_add_watch(jsonb, int);
create function public.cards_add_watch(p_viewers jsonb, p_minutes int default 5, p_stream_id text default null) returns int
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

    if v_every > 0 then
      v_due := u.total_minutes / v_every - u.watch_packs;
      if v_due > 0 then
        insert into cards_packs (twitch_id, source) select v.id, 'watch' from generate_series(1, v_due);
        update cards_users set watch_packs = watch_packs + v_due where twitch_id = v.id;
      end if;
    end if;

    perform cards_event_tick(v.id, p_minutes, p_stream_id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ── Zählen: nur Karten aus Packs zählen zur Sammlung, Event-Karten extra ────
create or replace function cards_public_info()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'launch_at', c.launch_at,
    'shiny_factor', c.shiny_factor,
    'packs_per_stream', c.points_packs_per_stream,
    'price', c.points_price,
    'watch_pack_minutes', c.watch_pack_minutes,
    'total', (select count(*) from cards_catalog where series = 1 and in_packs),
    'persons', (select count(*) from cards_catalog where series = 1 and kind = 'person'),
    'items', (select count(*) from cards_catalog where series = 1 and kind = 'item'),
    'rarities', (select jsonb_agg(jsonb_build_object('code', code, 'rank', rank, 'name', name, 'count', card_count) order by rank)
                 from cards_rarities),
    'stages', (select jsonb_agg(jsonb_build_object('stage', stage, 'minutes', min_minutes, 'name', name) order by stage)
               from cards_stages),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'description', e.description,
                         'card', e.card_id, 'starts_at', e.starts_at, 'ended', e.ends_at is not null and e.ends_at <= now(),
                         'min_minutes', e.min_minutes) order by e.starts_at)
                        from cards_events e), '[]'),
    'collectors', (select count(distinct i.twitch_id) from cards_inventory i
                   join cards_users u on u.twitch_id = i.twitch_id where i.qty > 0 and not u.hidden))
  from cards_config c where c.id = 1
$$;

create or replace function cards_status(p_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when u.twitch_id is null then jsonb_build_object('ok', false, 'reason', 'unbekannt') else
    jsonb_build_object(
      'ok', true,
      'name', u.display_name,
      'login', u.login,
      'minutes', u.total_minutes,
      'stage', s.stage,
      'stage_name', s.name,
      'next_stage_minutes', (select min(min_minutes) from cards_stages where min_minutes > u.total_minutes),
      'multiplier', round(cards_multiplier(s.stage), 2),
      'week_minutes', case when u.week_start = cards_week_start() then u.week_minutes else 0 end,
      'unopened', (select count(*) from cards_packs where twitch_id = u.twitch_id and opened_at is null),
      'starter_claimed', u.starter_claimed_at is not null,
      'collected', (select count(distinct i.card_id) from cards_inventory i join cards_catalog c on c.id = i.card_id
                    where i.twitch_id = u.twitch_id and i.qty > 0 and c.in_packs),
      'variants', (select count(distinct (i.card_id, i.rarity)) from cards_inventory i join cards_catalog c on c.id = i.card_id
                   where i.twitch_id = u.twitch_id and i.qty > 0 and c.in_packs),
      'shinies', (select count(distinct (card_id, rarity)) from cards_inventory where twitch_id = u.twitch_id and shiny and qty > 0),
      'total', (select count(*) from cards_catalog where series = 1 and in_packs),
      'variants_total', (select count(*) from cards_catalog where series = 1 and in_packs) * (select count(*) from cards_rarities),
      'hidden', u.hidden,
      'odds', (select jsonb_object_agg(code, chance) from cards_odds(s.stage, 1)))
  end
  from (select 1) one
  left join cards_users u on u.twitch_id = p_id
  left join cards_stages s on s.stage = cards_stage(u.total_minutes)
$$;

-- Errungenschaften: Ziele wachsen mit der Kartenzahl (0 = alle, -1 = die Hälfte)
update cards_achievements set name = 'Komplett!', description = 'Sammle alle Karten aus den Packs.', goal = 0 where code = 'cards_150';
update cards_achievements set name = 'Halbes Album', description = 'Sammle die Hälfte aller Karten.', goal = -1 where code = 'cards_75';
update cards_achievements set name = 'Vollendet', description = 'Sammle alle Versionen – jede Karte in allen 6 Seltenheiten.', goal = 0 where code = 'var_900';
insert into cards_achievements (code, sort, icon, name, description, stat, goal) values
  ('event_1', 35, '🎆', 'Dabei gewesen', 'Hol dir eine Event-Karte, indem du bei einem Event-Stream dabei bist.', 'events', 1)
on conflict (code) do update set sort = excluded.sort, icon = excluded.icon, name = excluded.name,
  description = excluded.description, stat = excluded.stat, goal = excluded.goal;

create or replace function cards_ach_goal(a cards_achievements)
returns int language sql stable set search_path = public as $$
  with n as (select count(*)::int packs, count(*) filter (where kind = 'person')::int persons
             from cards_catalog where series = 1 and in_packs)
  select case
    when a.goal > 0 then a.goal
    when a.stat = 'herd' then n.persons
    when a.stat = 'variants' then n.packs * 6
    when a.goal = -1 then (n.packs + 1) / 2
    else n.packs end
  from n
$$;

create or replace function cards_player_stats(p_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  with inv as (
    select i.card_id, i.rarity, i.shiny, c.number, c.kind, c.in_packs
    from cards_inventory i join cards_catalog c on c.id = i.card_id
    where i.twitch_id = p_id and i.qty > 0 and c.series = 1
  ), mine as (select id from cards_catalog where kind = 'person' and twitch_id = p_id limit 1)
  select jsonb_build_object(
    'packs',     (select count(*) from cards_packs where twitch_id = p_id and opened_at is not null),
    'cards',     (select count(distinct card_id) from inv where in_packs),
    'variants',  (select count(distinct (card_id, rarity)) from inv where in_packs),
    'animals',   (select count(distinct card_id) from inv where number between 30 and 49),
    'setup',     (select count(distinct card_id) from inv where number between 50 and 89),
    'herd',      (select count(distinct card_id) from inv where kind = 'person'),
    'boss',      (select count(*) from inv where number = 1),
    'rainbow',   coalesce((select max(n) from (select count(distinct rarity) n from inv group by card_id) x), 0),
    'epic',      (select count(*) from inv where cards_rank(rarity) >= 4),
    'legendary', (select count(*) from inv where cards_rank(rarity) >= 5),
    'mythic',    (select count(*) from inv where rarity = 'M'),
    'shinies',   (select count(distinct (card_id, rarity)) from inv where shiny),
    'upgrades',  (select count(*) from cards_upgrades where twitch_id = p_id),
    'trades',    (select count(*) from cards_trades where status = 'accepted' and p_id in (from_id, to_id)),
    'selfie',    (select count(*) from inv where card_id in (select id from mine)),
    'famous',    (select count(*) from cards_pulls where card_id in (select id from mine) and twitch_id <> p_id),
    'events',    (select count(distinct card_id) from inv where kind = 'event'))
$$;

-- ── Tauschen: jede Version (nicht nur doppelte), gleiche Seltenheit, keine Shinys, keine Event-Karten ──
create or replace function cards_trade_offer(p_from text, p_to_login text, p_offer text, p_want text, p_source text default 'chat')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg cards_config;
  v_to cards_users;
  v_offer text[] := cards_parse_variant(p_offer);
  v_want text[] := cards_parse_variant(p_want);
  v_trade bigint;
  v_expires timestamptz;
begin
  if not cards_is_open(p_from) then return jsonb_build_object('ok', false, 'reason', 'noch_nicht_gestartet'); end if;
  select * into cfg from cards_config where id = 1;
  select * into v_to from cards_users where lower(login) = lower(ltrim(trim(p_to_login), '@'));
  if v_to.twitch_id is null then return jsonb_build_object('ok', false, 'reason', 'partner_unbekannt'); end if;
  if v_to.twitch_id = p_from then return jsonb_build_object('ok', false, 'reason', 'selbst'); end if;
  if v_offer is null or v_want is null then return jsonb_build_object('ok', false, 'reason', 'karte_unbekannt'); end if;
  if exists (select 1 from cards_catalog where id in (v_offer[1], v_want[1]) and not tradable) then
    return jsonb_build_object('ok', false, 'reason', 'nicht_tauschbar');
  end if;
  if v_offer[2] <> v_want[2] then return jsonb_build_object('ok', false, 'reason', 'andere_seltenheit'); end if;
  if cards_qty(p_from, v_offer[1], v_offer[2]) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'nicht_im_besitz', 'card', v_offer[1] || '-' || v_offer[2]);
  end if;
  if cards_qty(v_to.twitch_id, v_want[1], v_want[2]) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'partner_hat_nicht', 'card', v_want[1] || '-' || v_want[2]);
  end if;
  if cards_trades_today(p_from) >= cfg.trades_per_day then
    return jsonb_build_object('ok', false, 'reason', 'limit', 'limit', cfg.trades_per_day);
  end if;

  if p_source = 'chat' then
    update cards_trades set status = 'cancelled', decided_at = now()
    where from_id = p_from and to_id = v_to.twitch_id and status = 'pending' and source = 'chat';
  end if;

  v_expires := now() + case when p_source = 'chat'
    then make_interval(mins => cfg.trade_minutes_chat)
    else make_interval(hours => cfg.trade_hours_web) end;
  insert into cards_trades (from_id, to_id, offer_card, want_card, rarity, source, expires_at)
  values (p_from, v_to.twitch_id, v_offer[1], v_want[1], v_offer[2], p_source, v_expires)
  returning id into v_trade;

  return jsonb_build_object('ok', true, 'trade', v_trade, 'expires_at', v_expires,
    'to', v_to.display_name, 'offer', cards_card_json(v_offer[1], v_offer[2]), 'want', cards_card_json(v_want[1], v_want[2]));
end $$;

create or replace function cards_trade_respond(p_trade_id bigint, p_actor text, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg cards_config;
  t cards_trades;
begin
  select * into t from cards_trades where id = p_trade_id for update;
  if not found or t.to_id <> p_actor then return jsonb_build_object('ok', false, 'reason', 'kein_angebot'); end if;
  if t.status <> 'pending' then return jsonb_build_object('ok', false, 'reason', 'erledigt', 'status', t.status); end if;
  if t.expires_at < now() then
    update cards_trades set status = 'expired', decided_at = now() where id = t.id;
    return jsonb_build_object('ok', false, 'reason', 'abgelaufen');
  end if;
  if not p_accept then
    update cards_trades set status = 'declined', decided_at = now() where id = t.id;
    return jsonb_build_object('ok', true, 'status', 'declined', 'trade', t.id);
  end if;

  select * into cfg from cards_config where id = 1;
  perform 1 from cards_inventory
  where rarity = t.rarity
    and (twitch_id, card_id) in ((t.from_id, t.offer_card), (t.from_id, t.want_card),
                                 (t.to_id, t.offer_card), (t.to_id, t.want_card))
  order by twitch_id, card_id, shiny for update;

  if cards_qty(t.from_id, t.offer_card, t.rarity) < 1 or cards_qty(t.to_id, t.want_card, t.rarity) < 1 then
    update cards_trades set status = 'cancelled', decided_at = now() where id = t.id;
    return jsonb_build_object('ok', false, 'reason', 'nicht_mehr_da');
  end if;
  if cards_trades_today(t.from_id) >= cfg.trades_per_day or cards_trades_today(t.to_id) >= cfg.trades_per_day then
    return jsonb_build_object('ok', false, 'reason', 'limit', 'limit', cfg.trades_per_day);
  end if;

  update cards_inventory set qty = qty - 1, last_at = now()
  where not shiny and rarity = t.rarity
    and ((twitch_id = t.from_id and card_id = t.offer_card)
      or (twitch_id = t.to_id and card_id = t.want_card));
  insert into cards_inventory (twitch_id, card_id, rarity, shiny, qty) values
    (t.to_id, t.offer_card, t.rarity, false, 1),
    (t.from_id, t.want_card, t.rarity, false, 1)
  on conflict (twitch_id, card_id, rarity, shiny)
    do update set qty = cards_inventory.qty + 1, last_at = now();

  update cards_trades set status = 'accepted', decided_at = now() where id = t.id;
  return jsonb_build_object('ok', true, 'status', 'accepted', 'trade', t.id,
    'from', (select display_name from cards_users where twitch_id = t.from_id),
    'to', (select display_name from cards_users where twitch_id = t.to_id),
    'offer', cards_card_json(t.offer_card, t.rarity), 'want', cards_card_json(t.want_card, t.rarity));
end $$;

-- Tauschvorschläge: alles, was dem anderen fehlt (doppelte zuerst, damit niemand ungewollt etwas verliert)
create or replace function cards_web_trade_suggestions()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id text := cards_auth_user();
begin
  return coalesce((
    with mine as (
      select i.card_id, i.rarity, i.qty >= 2 as dupe from cards_inventory i join cards_catalog c on c.id = i.card_id
      where i.twitch_id = v_id and not i.shiny and i.qty >= 1 and c.tradable
    ),
    others as (
      select twitch_id, login, display_name from cards_users where twitch_id <> v_id and not hidden
    ),
    theirs as (
      select i.twitch_id, i.card_id, i.rarity, i.qty >= 2 as dupe,
             not exists (select 1 from cards_inventory m where m.twitch_id = v_id and m.card_id = i.card_id and m.qty > 0) as missing_card
      from cards_inventory i
      join others o on o.twitch_id = i.twitch_id
      join cards_catalog c on c.id = i.card_id
      where not i.shiny and i.qty >= 1 and c.tradable
        and not exists (select 1 from cards_inventory m where m.twitch_id = v_id and m.card_id = i.card_id
                          and m.rarity = i.rarity and m.qty > 0)
    ),
    pairs as (
      select t.twitch_id, d.card_id as give, t.card_id as get, d.rarity, cards_rank(d.rarity) as rank, t.missing_card,
             (d.dupe::int + t.dupe::int) as dupes
      from mine d
      join theirs t on t.rarity = d.rarity
      where not exists (select 1 from cards_inventory x
                        where x.twitch_id = t.twitch_id and x.card_id = d.card_id and x.rarity = d.rarity and x.qty > 0)
    ),
    ranked as (
      select p.*, row_number() over (partition by p.twitch_id order by p.dupes desc, p.missing_card desc, p.rank desc, p.get, p.give) as rn,
             count(*) over (partition by p.twitch_id) as cnt,
             max(p.rank + case when p.missing_card then 10 else 0 end + p.dupes * 20) over (partition by p.twitch_id) as best
      from pairs p
    ),
    partners as (
      select k.twitch_id, max(k.cnt) as cnt, max(k.best) as best,
             jsonb_agg(jsonb_build_object('give', cards_card_json(k.give, k.rarity), 'get', cards_card_json(k.get, k.rarity),
                                          'missing', k.missing_card) order by k.rn) as swaps
      from ranked k where k.rn <= 4 group by k.twitch_id
      order by max(k.best) desc, max(k.cnt) desc limit 12
    )
    select jsonb_agg(jsonb_build_object('partner', o.display_name, 'login', o.login, 'count', p.cnt, 'swaps', p.swaps)
                     order by p.best desc, p.cnt desc, o.display_name)
    from partners p join others o on o.twitch_id = p.twitch_id
  ), '[]');
end $$;

-- ── Rechte ───────────────────────────────────────────────────────────────────
revoke all on function cards_admin_set_card(int, text, text, text, text, text) from public, anon, authenticated;
revoke all on function cards_admin_add_person(text, text) from public, anon, authenticated;
revoke all on function cards_event_tick(text, int, text) from public, anon, authenticated;
revoke all on function public.cards_add_watch(jsonb, int, text) from public, anon, authenticated;
revoke all on function cards_web_trade_suggestions() from public, anon;
grant execute on function cards_web_trade_suggestions() to authenticated;
grant execute on function cards_public_info() to anon, authenticated;
