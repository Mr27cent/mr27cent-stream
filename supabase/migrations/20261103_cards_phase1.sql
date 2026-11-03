-- ═══════════════════════════════════════════════════════════════════════════
--  Herden-Karten · Phase 1: Tabellen, Regeln, Ziehung, Tausch
--  Projekt: pgqpgvtscyxpghspnhdw (gemeinsam mit dem Idle-Spiel, Präfix cards_)
--
--  Alle Tabellen sind nur für den Server (RLS an, keine Policies).
--  Chat-Bot, Kanalpunkte und Webseite gehen ausschließlich über die Funktionen
--  unten. Funktionen geben bei Spielerfehlern {ok:false, reason:"..."} zurück,
--  echte Fehler (kaputte Daten) werfen eine Exception.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Einstellungen ────────────────────────────────────────────────────────────

create table public.cards_config (
  id int primary key default 1 check (id = 1),
  launch_at timestamptz not null default '2027-01-01 00:00:00+01',
  shiny_factor numeric not null default 0.01,      -- 1 % der Seltenheits-Chance
  max_multiplier numeric not null default 2.0,     -- Bonus auf der höchsten Stufe
  starter_packs int not null default 3,
  weekly_packs_sub int not null default 2,         -- Subs: 2 statt 1 Gratis-Pack
  weekly_min_minutes int not null default 30,
  points_price int,                                -- noch offen
  points_packs_per_stream int not null default 3,
  trades_per_day int not null default 5,
  trade_minutes_chat int not null default 2,
  trade_hours_web int not null default 48,
  alert_min_rank int not null default 5,           -- 5 = ab Legendary
  updated_at timestamptz not null default now()
);
insert into public.cards_config default values;

create table public.cards_rarities (
  code text primary key,
  rank int not null unique,
  name text not null,
  card_count int not null,
  base_chance numeric not null,   -- Prozent für Slot 1–4 auf Stufe 1
  boosted boolean not null        -- bekommt den Stufen-Multiplikator
);
insert into public.cards_rarities values
  ('C', 1, 'Common',    55, 62.0, false),
  ('U', 2, 'Uncommon',  40, 24.0, false),
  ('R', 3, 'Rare',      25,  9.0, false),
  ('E', 4, 'Epic',      15,  3.5, true),
  ('L', 5, 'Legendary', 10,  1.2, true),
  ('M', 6, 'Mythic',     5,  0.3, true);

-- Dieselben 27 Stufen wie die Herde (config.js → herd.stages)
create table public.cards_stages (
  stage int primary key,
  min_minutes int not null unique,
  name text not null
);
insert into public.cards_stages (stage, min_minutes, name) values
  ( 1,     0, 'Neugeborenes Kitz'),
  ( 2,    60, 'Wackelbeinchen'),
  ( 3,   180, 'Grashalm-Knabberer'),
  ( 4,   300, 'Kitz'),
  ( 5,   480, 'Neugieriges Kitz'),
  ( 6,   720, 'Pfützenspringer'),
  ( 7,  1020, 'Halmhüpfer'),
  ( 8,  1380, 'Jährling'),
  ( 9,  1800, 'Staubaufwirbler'),
  (10,  2400, 'Akazienschatten-Kenner'),
  (11,  3000, 'Junggazelle'),
  (12,  3900, 'Wasserloch-Stammgast'),
  (13,  4800, 'Steppenflitzer'),
  (14,  6000, 'Morgentau-Sprinter'),
  (15,  7500, 'Kleine Hörner'),
  (16,  9000, 'Savannenspringer'),
  (17, 11100, 'Dornbusch-Slalomer'),
  (18, 13500, 'Herdenmitglied'),
  (19, 16200, 'Spurenleser'),
  (20, 19200, 'Windschnell'),
  (21, 22800, 'Abendrot-Gazelle'),
  (22, 27000, 'Löwenschreck'),
  (23, 31800, 'Graslandwächter'),
  (24, 37200, 'Wächter der Herde'),
  (25, 43200, 'Sternenhimmel-Gazelle'),
  (26, 51000, 'Weise der Savanne'),
  (27, 60000, 'Universumsgazelle');

-- Bots und der Kanal selbst sammeln keine Zeit (wie IGNORE_USERS in Code.gs)
create table public.cards_ignored (login text primary key);
insert into public.cards_ignored values
  ('mr27cent'), ('streamelements'), ('streamlabs'), ('nightbot'), ('moobot'), ('fossabot'),
  ('wizebot'), ('soundalerts'), ('sery_bot'), ('commanderroot'), ('streamerbot'), ('kofistreambot'),
  ('tangiabot'), ('frostytools'), ('streamstickers'), ('anotherttvviewer'), ('lurxx'), ('aliceydra'),
  ('drapsnatt'), ('0ax2'), ('kattah'), ('pokemoncommunitygame'), ('botrixoficial'), ('blerp'),
  ('streamlootsbot'), ('own3d'), ('creatisbot'), ('deepbot'), ('coebot'), ('phantombot'), ('ankhbot'),
  ('vivbot'), ('botisimo'), ('pretzelrocks'), ('songlistbot'), ('restreambot'), ('playwithviewersbot');

-- ── Karten ───────────────────────────────────────────────────────────────────

create table public.cards_catalog (
  id text primary key,                 -- z. B. S1-147
  series int not null,
  number int not null,
  rarity text not null references public.cards_rarities(code),
  name text not null,
  image text,
  flavor text,
  in_packs boolean not null default true,
  unique (series, number)
);
-- Serie 1: Platzhalter, bis die echte Kartenliste steht
insert into public.cards_catalog (id, series, number, rarity, name)
select 'S1-' || lpad(n::text, 3, '0'), 1, n,
  case when n <= 55 then 'C' when n <= 95 then 'U' when n <= 120 then 'R'
       when n <= 135 then 'E' when n <= 145 then 'L' else 'M' end,
  'Platzhalter #' || lpad(n::text, 3, '0')
from generate_series(1, 150) n;

-- ── Spieler & Sammlung ───────────────────────────────────────────────────────

create table public.cards_users (
  twitch_id text primary key,
  login text not null,
  display_name text not null,
  total_minutes int not null default 0,   -- ab Start (01.01.2027), nie zurückgesetzt
  week_start date,
  week_minutes int not null default 0,
  hidden boolean not null default false,  -- !karten aus
  is_tester boolean not null default false,
  starter_claimed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index cards_users_login on public.cards_users (lower(login));

create table public.cards_packs (
  id bigint generated always as identity primary key,
  twitch_id text not null references public.cards_users,
  source text not null check (source in ('starter', 'weekly', 'sub', 'points', 'admin')),
  guarantee text references public.cards_rarities(code),   -- Slot 5 mindestens diese Seltenheit
  no_dupes boolean not null default false,                 -- keine Karte, die man schon hat
  stream_id text,
  redemption_id text unique,
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  stage_at_open int
);
create index cards_packs_unopened on public.cards_packs (twitch_id, id) where opened_at is null;
create index cards_packs_points on public.cards_packs (twitch_id, stream_id) where source = 'points';

create table public.cards_pulls (
  id bigint generated always as identity primary key,
  pack_id bigint not null references public.cards_packs on delete cascade,
  twitch_id text not null references public.cards_users,
  slot int not null,
  card_id text not null references public.cards_catalog,
  shiny boolean not null,
  created_at timestamptz not null default now()
);
create index cards_pulls_pack on public.cards_pulls (pack_id);

create table public.cards_inventory (
  twitch_id text not null references public.cards_users,
  card_id text not null references public.cards_catalog,
  shiny boolean not null,
  qty int not null check (qty >= 0),
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (twitch_id, card_id, shiny)
);
create index cards_inventory_card on public.cards_inventory (card_id) where qty > 0;

-- Welche Version im Album gezeigt wird (ohne Eintrag: Shiny, falls vorhanden)
create table public.cards_display (
  twitch_id text not null references public.cards_users,
  card_id text not null references public.cards_catalog,
  show_shiny boolean not null,
  primary key (twitch_id, card_id)
);

create table public.cards_weekly_claims (
  twitch_id text not null references public.cards_users,
  week_start date not null,
  kind text not null check (kind in ('free', 'sub')),
  pack_id bigint references public.cards_packs on delete set null,
  claimed_at timestamptz not null default now(),
  primary key (twitch_id, week_start, kind)
);

create table public.cards_trades (
  id bigint generated always as identity primary key,
  from_id text not null references public.cards_users,
  to_id text not null references public.cards_users,
  offer_card text not null references public.cards_catalog,
  want_card text not null references public.cards_catalog,
  source text not null check (source in ('chat', 'web')),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_at timestamptz
);
create index cards_trades_open_to on public.cards_trades (to_id, created_at desc) where status = 'pending';
create index cards_trades_open_from on public.cards_trades (from_id) where status = 'pending';
create index cards_trades_done on public.cards_trades (decided_at) where status = 'accepted';

create table public.cards_overlay_queue (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  twitch_id text not null,
  display_name text not null,
  card_id text not null references public.cards_catalog,
  shiny boolean not null,
  shown_at timestamptz
);

alter table public.cards_config        enable row level security;
alter table public.cards_rarities      enable row level security;
alter table public.cards_stages        enable row level security;
alter table public.cards_ignored       enable row level security;
alter table public.cards_catalog       enable row level security;
alter table public.cards_users         enable row level security;
alter table public.cards_packs         enable row level security;
alter table public.cards_pulls         enable row level security;
alter table public.cards_inventory     enable row level security;
alter table public.cards_display       enable row level security;
alter table public.cards_weekly_claims enable row level security;
alter table public.cards_trades        enable row level security;
alter table public.cards_overlay_queue enable row level security;

-- ── Hilfsfunktionen ──────────────────────────────────────────────────────────

-- Kryptografischer Zufall in [0, 1)
create function public.cards_rand() returns double precision
language sql volatile set search_path = '' as $$
  select (('x' || encode(extensions.gen_random_bytes(7), 'hex'))::bit(56)::bigint)::double precision
         / 72057594037927936.0
$$;

-- Montag der aktuellen Woche (deutsche Zeit)
create function public.cards_week_start(ts timestamptz default now()) returns date
language sql stable set search_path = '' as $$
  select date_trunc('week', ts at time zone 'Europe/Berlin')::date
$$;

create function public.cards_stage(p_minutes int) returns int
language sql stable set search_path = public as $$
  select coalesce(max(stage), 1) from cards_stages where min_minutes <= coalesce(p_minutes, 0)
$$;

-- x1 auf Stufe 1 bis max_multiplier auf der höchsten Stufe, linear
create function public.cards_multiplier(p_stage int) returns numeric
language sql stable set search_path = public as $$
  select 1 + (c.max_multiplier - 1) * (least(greatest(p_stage, 1), s.top) - 1)::numeric / greatest(s.top - 1, 1)
  from cards_config c, (select max(stage) top from cards_stages) s
  where c.id = 1
$$;

-- Chancen in Prozent. p_min_rank = 3 ergibt Slot 5 (Rare oder besser).
-- Der Bonus auf Epic/Legendary/Mythic wird von Common abgezogen.
create function public.cards_odds(p_stage int, p_min_rank int default 1)
returns table (code text, rank int, name text, chance numeric)
language sql stable security definer set search_path = public as $$
  with m as (select cards_multiplier(p_stage) m),
  extra as (
    select coalesce(sum(r.base_chance * (m.m - 1)), 0) e
    from cards_rarities r, m where r.boosted
  ),
  adj as (
    select r.code, r.rank, r.name,
      case when r.boosted then r.base_chance * m.m
           when r.rank = 1 then r.base_chance - extra.e
           else r.base_chance end ch
    from cards_rarities r, m, extra
    where r.rank >= p_min_rank
  )
  select code, rank, name, round(ch * 100 / sum(ch) over (), 6) from adj order by rank
$$;

create function public.cards_pick_rarity(p_stage int, p_min_rank int) returns text
language plpgsql volatile set search_path = public as $$
declare
  x numeric := cards_rand() * 100;
  r record;
  fallback text;
begin
  for r in select * from cards_odds(p_stage, p_min_rank) loop
    fallback := coalesce(fallback, r.code);
    x := x - r.chance;
    if x < 0 then return r.code; end if;
  end loop;
  return fallback;  -- Rundungsrest
end $$;

create function public.cards_pick_card(p_rarity text, p_exclude text[]) returns text
language sql volatile set search_path = public as $$
  select id from cards_catalog
  where rarity = p_rarity and in_packs and not (id = any (coalesce(p_exclude, '{}')))
  order by cards_rand() limit 1
$$;

-- "147", "#147", "s1-147" → "S1-147"
create function public.cards_card_id(p_text text) returns text
language sql stable set search_path = public as $$
  select id from cards_catalog
  where id = case
    when trim(p_text) ~ '^#?\d{1,3}$' then 'S1-' || lpad(ltrim(trim(p_text), '#'), 3, '0')
    else upper(trim(p_text)) end
$$;

create function public.cards_is_open(p_id text) returns boolean
language sql stable set search_path = public as $$
  select now() >= (select launch_at from cards_config where id = 1)
      or coalesce((select is_tester from cards_users where twitch_id = p_id), false)
$$;

-- Spieler anlegen bzw. Namen aktualisieren (Umbenennungen bei Twitch)
create function public.cards_touch_user(p_id text, p_login text, p_name text) returns void
language plpgsql volatile set search_path = public as $$
begin
  -- Jemand anderes hatte den Namen früher → alten Eintrag umbenennen
  update cards_users set login = login || '~' || twitch_id
  where lower(login) = lower(p_login) and twitch_id <> p_id;
  insert into cards_users (twitch_id, login, display_name)
  values (p_id, lower(p_login), coalesce(nullif(p_name, ''), p_login))
  on conflict (twitch_id) do update
    set login = excluded.login, display_name = excluded.display_name
    where cards_users.login <> excluded.login or cards_users.display_name <> excluded.display_name;
end $$;

create function public.cards_trades_today(p_id text) returns int
language sql stable set search_path = public as $$
  select count(*)::int from cards_trades
  where status = 'accepted' and (from_id = p_id or to_id = p_id)
    and (decided_at at time zone 'Europe/Berlin')::date = (now() at time zone 'Europe/Berlin')::date
$$;

create function public.cards_card_json(p_card text, p_shiny boolean default false) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', c.id, 'number', c.number, 'name', c.name,
                            'rarity', c.rarity, 'rarity_name', r.name, 'shiny', p_shiny)
  from cards_catalog c join cards_rarities r on r.code = c.rarity where c.id = p_card
$$;

-- ── Packs ────────────────────────────────────────────────────────────────────

create function public.cards_open_pack(p_pack_id bigint) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  p cards_packs;
  u cards_users;
  cfg cards_config;
  v_stage int;
  v_exclude text[] := '{}';
  v_min int;
  v_rarity text;
  v_rank int;
  v_card text;
  v_shiny boolean;
  v_new boolean;
  v_out jsonb := '[]';
  i int;
begin
  select * into p from cards_packs where id = p_pack_id for update;
  if not found then raise exception 'Pack % gibt es nicht', p_pack_id; end if;
  if p.opened_at is not null then return jsonb_build_object('ok', false, 'reason', 'schon_offen'); end if;

  select * into u from cards_users where twitch_id = p.twitch_id;
  select * into cfg from cards_config where id = 1;
  v_stage := cards_stage(u.total_minutes);

  if p.no_dupes then
    select coalesce(array_agg(distinct card_id), '{}') into v_exclude
    from cards_inventory where twitch_id = p.twitch_id and qty > 0;
  end if;

  for i in 1..5 loop
    v_min := case when i = 5
      then greatest(3, coalesce((select rank from cards_rarities where code = p.guarantee), 3))
      else 1 end;
    v_rarity := cards_pick_rarity(v_stage, v_min);
    v_card := cards_pick_card(v_rarity, case when p.no_dupes then v_exclude else '{}' end);
    if v_card is null then v_card := cards_pick_card(v_rarity, '{}'); end if;
    v_exclude := v_exclude || v_card;
    -- Shiny: 1 % der Seltenheits-Chance, also 1 % pro gezogener Karte
    v_shiny := cards_rand() < cfg.shiny_factor;
    v_new := not exists (select 1 from cards_inventory
                         where twitch_id = p.twitch_id and card_id = v_card and qty > 0);

    insert into cards_pulls (pack_id, twitch_id, slot, card_id, shiny)
    values (p.id, p.twitch_id, i, v_card, v_shiny);
    insert into cards_inventory (twitch_id, card_id, shiny, qty)
    values (p.twitch_id, v_card, v_shiny, 1)
    on conflict (twitch_id, card_id, shiny)
      do update set qty = cards_inventory.qty + 1, last_at = now();

    select rank into v_rank from cards_rarities where code = v_rarity;
    if v_shiny or v_rank >= cfg.alert_min_rank then
      insert into cards_overlay_queue (twitch_id, display_name, card_id, shiny)
      values (p.twitch_id, u.display_name, v_card, v_shiny);
    end if;

    v_out := v_out || (cards_card_json(v_card, v_shiny) || jsonb_build_object('slot', i, 'new', v_new));
  end loop;

  update cards_packs set opened_at = now(), stage_at_open = v_stage where id = p.id;
  return jsonb_build_object('ok', true, 'pack', p.id, 'source', p.source, 'stage', v_stage,
                            'name', u.display_name, 'cards', v_out);
end $$;

-- Ältestes ungeöffnetes Pack öffnen (!open)
create function public.cards_open_next(p_id text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_pack bigint;
begin
  select id into v_pack from cards_packs
  where twitch_id = p_id and opened_at is null order by id limit 1;
  if v_pack is null then return jsonb_build_object('ok', false, 'reason', 'keine_packs'); end if;
  return cards_open_pack(v_pack) || jsonb_build_object(
    'left', (select count(*) from cards_packs where twitch_id = p_id and opened_at is null));
end $$;

-- !starter: 3 Packs ohne Duplikate, eines davon mit Epic+ in Slot 5
create function public.cards_claim_starter(p_id text, p_login text, p_name text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  u cards_users;
  cfg cards_config;
  v_epic int;
  v_ids bigint[] := '{}';
  v_pack bigint;
  i int;
begin
  perform cards_touch_user(p_id, p_login, p_name);
  if not cards_is_open(p_id) then return jsonb_build_object('ok', false, 'reason', 'noch_nicht_gestartet'); end if;
  select * into u from cards_users where twitch_id = p_id for update;
  if u.starter_claimed_at is not null then return jsonb_build_object('ok', false, 'reason', 'schon_abgeholt'); end if;
  select * into cfg from cards_config where id = 1;

  v_epic := 1 + floor(cards_rand() * cfg.starter_packs)::int;
  for i in 1..cfg.starter_packs loop
    insert into cards_packs (twitch_id, source, no_dupes, guarantee)
    values (p_id, 'starter', true, case when i = v_epic then 'E' end)
    returning id into v_pack;
    v_ids := v_ids || v_pack;
  end loop;
  update cards_users set starter_claimed_at = now() where twitch_id = p_id;
  return jsonb_build_object('ok', true, 'packs', to_jsonb(v_ids));
end $$;

-- !freepack: 1 Pack pro Woche (Subs 2), nur mit genug Zuschauzeit in der Woche
create function public.cards_claim_weekly(p_id text, p_login text, p_name text, p_is_sub boolean)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  u cards_users;
  cfg cards_config;
  v_week date := cards_week_start();
  v_minutes int;
  v_ids bigint[] := '{}';
  v_pack bigint;
  v_kind text;
begin
  perform cards_touch_user(p_id, p_login, p_name);
  if not cards_is_open(p_id) then return jsonb_build_object('ok', false, 'reason', 'noch_nicht_gestartet'); end if;
  select * into u from cards_users where twitch_id = p_id for update;
  select * into cfg from cards_config where id = 1;

  v_minutes := case when u.week_start = v_week then u.week_minutes else 0 end;
  if v_minutes < cfg.weekly_min_minutes then
    return jsonb_build_object('ok', false, 'reason', 'zu_wenig_zeit',
                              'minutes', v_minutes, 'needed', cfg.weekly_min_minutes);
  end if;

  foreach v_kind in array case when p_is_sub and cfg.weekly_packs_sub > 1
                               then array['free', 'sub'] else array['free'] end loop
    if not exists (select 1 from cards_weekly_claims
                   where twitch_id = p_id and week_start = v_week and kind = v_kind) then
      insert into cards_packs (twitch_id, source)
      values (p_id, case when v_kind = 'free' then 'weekly' else 'sub' end)
      returning id into v_pack;
      insert into cards_weekly_claims (twitch_id, week_start, kind, pack_id)
      values (p_id, v_week, v_kind, v_pack);
      v_ids := v_ids || v_pack;
    end if;
  end loop;

  if cardinality(v_ids) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'schon_abgeholt', 'next', v_week + 7);
  end if;
  return jsonb_build_object('ok', true, 'packs', to_jsonb(v_ids));
end $$;

-- Kanalpunkte-Einlösung: Pack anlegen und sofort öffnen.
-- ok:false → Edge Function setzt die Einlösung auf CANCELED (Punkte zurück).
create function public.cards_points_pack(p_id text, p_login text, p_name text,
                                         p_redemption_id text, p_stream_id text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  cfg cards_config;
  v_pack bigint;
begin
  if exists (select 1 from cards_packs where redemption_id = p_redemption_id) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  perform cards_touch_user(p_id, p_login, p_name);
  if not cards_is_open(p_id) then return jsonb_build_object('ok', false, 'reason', 'noch_nicht_gestartet'); end if;
  perform 1 from cards_users where twitch_id = p_id for update;
  select * into cfg from cards_config where id = 1;

  if (select count(*) from cards_packs
      where twitch_id = p_id and source = 'points' and stream_id is not distinct from p_stream_id)
     >= cfg.points_packs_per_stream then
    return jsonb_build_object('ok', false, 'reason', 'limit', 'limit', cfg.points_packs_per_stream);
  end if;

  insert into cards_packs (twitch_id, source, stream_id, redemption_id)
  values (p_id, 'points', p_stream_id, p_redemption_id)
  returning id into v_pack;
  return cards_open_pack(v_pack);
end $$;

-- Für Tests und Gewinnspiele
create function public.cards_admin_give_packs(p_id text, p_count int) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_ids bigint[] := '{}'; v_pack bigint; i int;
begin
  if not exists (select 1 from cards_users where twitch_id = p_id) then
    return jsonb_build_object('ok', false, 'reason', 'unbekannt');
  end if;
  for i in 1..p_count loop
    insert into cards_packs (twitch_id, source) values (p_id, 'admin') returning id into v_pack;
    v_ids := v_ids || v_pack;
  end loop;
  return jsonb_build_object('ok', true, 'packs', to_jsonb(v_ids));
end $$;

-- ── Zuschauzeit ──────────────────────────────────────────────────────────────

-- Vom twitch-tick alle 5 Minuten: [{"id":"123","login":"abc","name":"Abc"}, …]
-- Vor dem Start zählen nur Tester.
create function public.cards_add_watch(p_viewers jsonb, p_minutes int default 5) returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  v_week date := cards_week_start();
  v_launched boolean := now() >= (select launch_at from cards_config where id = 1);
  v record;
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
    where twitch_id = v.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ── Tauschen ─────────────────────────────────────────────────────────────────

create function public.cards_qty(p_id text, p_card text) returns int
language sql stable set search_path = public as $$
  select coalesce((select qty from cards_inventory
                   where twitch_id = p_id and card_id = p_card and not shiny), 0)
$$;

-- !trade @user <meine> <seine>: nur Duplikate, gleiche Seltenheit, keine Shinys
create function public.cards_trade_offer(p_from text, p_to_login text, p_offer text, p_want text,
                                         p_source text default 'chat')
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  cfg cards_config;
  v_to cards_users;
  v_offer text := cards_card_id(p_offer);
  v_want text := cards_card_id(p_want);
  v_trade bigint;
  v_expires timestamptz;
begin
  if not cards_is_open(p_from) then return jsonb_build_object('ok', false, 'reason', 'noch_nicht_gestartet'); end if;
  select * into cfg from cards_config where id = 1;
  select * into v_to from cards_users where lower(login) = lower(ltrim(trim(p_to_login), '@'));
  if v_to.twitch_id is null then return jsonb_build_object('ok', false, 'reason', 'partner_unbekannt'); end if;
  if v_to.twitch_id = p_from then return jsonb_build_object('ok', false, 'reason', 'selbst'); end if;
  if v_offer is null or v_want is null then return jsonb_build_object('ok', false, 'reason', 'karte_unbekannt'); end if;
  if (select rarity from cards_catalog where id = v_offer) <> (select rarity from cards_catalog where id = v_want) then
    return jsonb_build_object('ok', false, 'reason', 'andere_seltenheit');
  end if;
  if cards_qty(p_from, v_offer) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'kein_duplikat_eigen', 'card', v_offer);
  end if;
  if cards_qty(v_to.twitch_id, v_want) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'kein_duplikat_partner', 'card', v_want);
  end if;
  if cards_trades_today(p_from) >= cfg.trades_per_day then
    return jsonb_build_object('ok', false, 'reason', 'limit', 'limit', cfg.trades_per_day);
  end if;

  -- Im Chat gilt immer nur das neueste Angebot an dieselbe Person
  if p_source = 'chat' then
    update cards_trades set status = 'cancelled', decided_at = now()
    where from_id = p_from and to_id = v_to.twitch_id and status = 'pending' and source = 'chat';
  end if;

  v_expires := now() + case when p_source = 'chat'
    then make_interval(mins => cfg.trade_minutes_chat)
    else make_interval(hours => cfg.trade_hours_web) end;
  insert into cards_trades (from_id, to_id, offer_card, want_card, source, expires_at)
  values (p_from, v_to.twitch_id, v_offer, v_want, p_source, v_expires)
  returning id into v_trade;

  return jsonb_build_object('ok', true, 'trade', v_trade, 'expires_at', v_expires,
    'to', v_to.display_name, 'offer', cards_card_json(v_offer), 'want', cards_card_json(v_want));
end $$;

create function public.cards_trade_respond(p_trade_id bigint, p_actor text, p_accept boolean)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
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
  -- Beide Sammlungen in fester Reihenfolge sperren (keine Deadlocks)
  perform 1 from cards_inventory
  where (twitch_id, card_id) in ((t.from_id, t.offer_card), (t.from_id, t.want_card),
                                 (t.to_id, t.offer_card), (t.to_id, t.want_card))
  order by twitch_id, card_id, shiny for update;

  if cards_qty(t.from_id, t.offer_card) < 2 or cards_qty(t.to_id, t.want_card) < 2 then
    update cards_trades set status = 'cancelled', decided_at = now() where id = t.id;
    return jsonb_build_object('ok', false, 'reason', 'nicht_mehr_doppelt');
  end if;
  if cards_trades_today(t.from_id) >= cfg.trades_per_day or cards_trades_today(t.to_id) >= cfg.trades_per_day then
    return jsonb_build_object('ok', false, 'reason', 'limit', 'limit', cfg.trades_per_day);
  end if;

  update cards_inventory set qty = qty - 1, last_at = now()
  where not shiny and ((twitch_id = t.from_id and card_id = t.offer_card)
                    or (twitch_id = t.to_id and card_id = t.want_card));
  insert into cards_inventory (twitch_id, card_id, shiny, qty) values
    (t.to_id, t.offer_card, false, 1),
    (t.from_id, t.want_card, false, 1)
  on conflict (twitch_id, card_id, shiny)
    do update set qty = cards_inventory.qty + 1, last_at = now();

  update cards_trades set status = 'accepted', decided_at = now() where id = t.id;
  return jsonb_build_object('ok', true, 'status', 'accepted', 'trade', t.id,
    'from', (select display_name from cards_users where twitch_id = t.from_id),
    'to', (select display_name from cards_users where twitch_id = t.to_id),
    'offer', cards_card_json(t.offer_card), 'want', cards_card_json(t.want_card));
end $$;

-- !accept / !decline im Chat: neuestes offenes Angebot an mich
create function public.cards_trade_respond_latest(p_actor text, p_accept boolean) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_trade bigint;
begin
  select id into v_trade from cards_trades
  where to_id = p_actor and status = 'pending' and expires_at >= now()
  order by created_at desc limit 1;
  if v_trade is null then return jsonb_build_object('ok', false, 'reason', 'kein_angebot'); end if;
  return cards_trade_respond(v_trade, p_actor, p_accept);
end $$;

create function public.cards_trade_cancel(p_trade_id bigint, p_actor text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  update cards_trades set status = 'cancelled', decided_at = now()
  where id = p_trade_id and from_id = p_actor and status = 'pending';
  if not found then return jsonb_build_object('ok', false, 'reason', 'kein_angebot'); end if;
  return jsonb_build_object('ok', true);
end $$;

create function public.cards_expire_trades() returns int
language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  update cards_trades set status = 'expired', decided_at = now()
  where status = 'pending' and expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;

-- ── Album-Einstellungen ──────────────────────────────────────────────────────

create function public.cards_set_hidden(p_id text, p_hidden boolean) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  update cards_users set hidden = p_hidden where twitch_id = p_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'unbekannt'); end if;
  return jsonb_build_object('ok', true, 'hidden', p_hidden);
end $$;

-- !zeige <nr> shiny|normal: geht nur, wenn man die Version besitzt
create function public.cards_set_display(p_id text, p_card text, p_shiny boolean) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_card text := cards_card_id(p_card);
begin
  if v_card is null then return jsonb_build_object('ok', false, 'reason', 'karte_unbekannt'); end if;
  if not exists (select 1 from cards_inventory
                 where twitch_id = p_id and card_id = v_card and shiny = p_shiny and qty > 0) then
    return jsonb_build_object('ok', false, 'reason', 'nicht_im_besitz', 'card', v_card);
  end if;
  insert into cards_display (twitch_id, card_id, show_shiny) values (p_id, v_card, p_shiny)
  on conflict (twitch_id, card_id) do update set show_shiny = excluded.show_shiny;
  return jsonb_build_object('ok', true, 'card', cards_card_json(v_card, p_shiny));
end $$;

-- ── Lesen (Chat, Webseite) ───────────────────────────────────────────────────

-- !packs, !chancen, !album: Kurzüberblick
create function public.cards_status(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$
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
      'collected', (select count(distinct card_id) from cards_inventory where twitch_id = u.twitch_id and qty > 0),
      'shinies', (select count(distinct card_id) from cards_inventory where twitch_id = u.twitch_id and shiny and qty > 0),
      'total', (select count(*) from cards_catalog where series = 1),
      'hidden', u.hidden,
      'odds', (select jsonb_object_agg(code, chance) from cards_odds(s.stage, 1)))
  end
  from (select 1) one
  left join cards_users u on u.twitch_id = p_id
  left join cards_stages s on s.stage = cards_stage(u.total_minutes)
$$;

-- !karte <nr>: Wie oft habe ich Karte X?
create function public.cards_card_info(p_id text, p_card text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when c.id is null then jsonb_build_object('ok', false, 'reason', 'karte_unbekannt') else
    cards_card_json(c.id) || jsonb_build_object('ok', true,
      'qty', cards_qty(p_id, c.id),
      'shiny_qty', coalesce((select qty from cards_inventory where twitch_id = p_id and card_id = c.id and shiny), 0))
  end
  from (select cards_card_id(p_card) id) c
$$;

-- Album für die Webseite. p_viewer = eigene Twitch-ID (darf versteckte eigene Alben sehen).
create function public.cards_album(p_login text, p_viewer text default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when u.twitch_id is null then jsonb_build_object('ok', false, 'reason', 'unbekannt')
    when u.hidden and u.twitch_id is distinct from p_viewer then jsonb_build_object('ok', false, 'reason', 'versteckt')
    else jsonb_build_object(
      'ok', true,
      'name', u.display_name,
      'login', u.login,
      'stage', cards_stage(u.total_minutes),
      'cards', (
        select jsonb_agg(jsonb_build_object(
          'id', c.id, 'number', c.number, 'rarity', c.rarity,
          'name', case when coalesce(n.qty, 0) + coalesce(sh.qty, 0) > 0 then c.name end,
          'image', case when coalesce(n.qty, 0) + coalesce(sh.qty, 0) > 0 then c.image end,
          'qty', coalesce(n.qty, 0),
          'shiny_qty', coalesce(sh.qty, 0),
          'show_shiny', coalesce(sh.qty, 0) > 0 and coalesce(d.show_shiny, true)
        ) order by c.number)
        from cards_catalog c
        left join cards_inventory n on n.twitch_id = u.twitch_id and n.card_id = c.id and not n.shiny
        left join cards_inventory sh on sh.twitch_id = u.twitch_id and sh.card_id = c.id and sh.shiny
        left join cards_display d on d.twitch_id = u.twitch_id and d.card_id = c.id
        where c.series = 1))
  end
  from (select 1) one
  left join cards_users u on lower(u.login) = lower(ltrim(trim(p_login), '@'))
$$;

-- Öffentlich: nur nicht versteckte Alben (das eigene versteckte zeigt Phase 4 nach Login)
create function public.cards_album_public(p_login text) returns jsonb
language sql stable security definer set search_path = public as $$
  select cards_album(p_login, null)
$$;

-- Ranglisten: 'complete' (x/150), 'shiny' (verschiedene Shinys), 'mythic' (verschiedene Mythics)
create function public.cards_leaderboard(p_kind text, p_limit int default 25)
returns table (place bigint, name text, login text, value bigint)
language sql stable security definer set search_path = public as $$
  with v as (
    select i.twitch_id, count(distinct i.card_id) value
    from cards_inventory i join cards_catalog c on c.id = i.card_id
    where i.qty > 0
      and case p_kind when 'shiny' then i.shiny when 'mythic' then c.rarity = 'M' else true end
    group by i.twitch_id
  )
  select rank() over (order by v.value desc), u.display_name, u.login, v.value
  from v join cards_users u on u.twitch_id = v.twitch_id
  where not u.hidden
  order by v.value desc, u.display_name
  limit least(greatest(p_limit, 1), 100)
$$;

-- ── Rechte ───────────────────────────────────────────────────────────────────
-- Standardmäßig darf in Supabase jeder Funktionen in public aufrufen → alles zu,
-- nur die reinen Lese-Funktionen ohne Geheimnisse gibt es öffentlich.

do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname like 'cards\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

revoke all on public.cards_config, public.cards_rarities, public.cards_stages, public.cards_ignored,
  public.cards_catalog, public.cards_users, public.cards_packs, public.cards_pulls,
  public.cards_inventory, public.cards_display, public.cards_weekly_claims, public.cards_trades,
  public.cards_overlay_queue from anon, authenticated;

grant execute on function public.cards_odds(int, int) to anon, authenticated;
grant execute on function public.cards_leaderboard(text, int) to anon, authenticated;
grant execute on function public.cards_album_public(text) to anon, authenticated;
