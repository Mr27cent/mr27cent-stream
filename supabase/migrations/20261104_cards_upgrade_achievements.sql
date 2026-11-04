-- Herden-Karten: Hochstufen (3 gleiche → 1 höhere), Errungenschaften (wie Steam), Zähler „Deine Karte wurde gezogen“
-- Stand 04.11.2026

-- ── Hochstufen ───────────────────────────────────────────────────────────────
-- Wer 3 gleiche Versionen hat (Karte + Seltenheit + Shiny ja/nein), gibt 2 davon ab und bekommt
-- dieselbe Karte eine Seltenheit höher. Eine bleibt behalten, damit die Version im Album bleibt.
create table if not exists cards_upgrades (
  id bigint generated always as identity primary key,
  twitch_id text not null references cards_users,
  card_id text not null references cards_catalog,
  from_rarity text not null references cards_rarities(code),
  to_rarity text not null references cards_rarities(code),
  shiny boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists cards_upgrades_user on cards_upgrades (twitch_id);
alter table cards_upgrades enable row level security;

alter table cards_config add column if not exists upgrade_need int not null default 3;

create or replace function cards_upgrade(p_id text, p_version text, p_shiny boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg cards_config;
  u cards_users;
  v text[] := cards_parse_variant(p_version);
  v_have int;
  v_next text;
  v_new_variant boolean;
  v_shiny boolean := coalesce(p_shiny, false);
begin
  if not cards_is_open(p_id) then return jsonb_build_object('ok', false, 'reason', 'noch_nicht_gestartet'); end if;
  if v is null then return jsonb_build_object('ok', false, 'reason', 'karte_unbekannt'); end if;
  select * into cfg from cards_config where id = 1;
  select * into u from cards_users where twitch_id = p_id;
  select code into v_next from cards_rarities where rank = cards_rank(v[2]) + 1;
  if v_next is null then return jsonb_build_object('ok', false, 'reason', 'schon_hoechste'); end if;

  select qty into v_have from cards_inventory
  where twitch_id = p_id and card_id = v[1] and rarity = v[2] and shiny = v_shiny for update;
  if coalesce(v_have, 0) < cfg.upgrade_need then
    return jsonb_build_object('ok', false, 'reason', 'zu_wenig', 'have', coalesce(v_have, 0), 'need', cfg.upgrade_need);
  end if;

  v_new_variant := not exists (select 1 from cards_inventory where twitch_id = p_id and card_id = v[1]
                               and rarity = v_next and shiny = v_shiny and qty > 0);
  update cards_inventory set qty = qty - (cfg.upgrade_need - 1), last_at = now()
  where twitch_id = p_id and card_id = v[1] and rarity = v[2] and shiny = v_shiny;
  insert into cards_inventory (twitch_id, card_id, rarity, shiny, qty) values (p_id, v[1], v_next, v_shiny, 1)
  on conflict (twitch_id, card_id, rarity, shiny) do update set qty = cards_inventory.qty + 1, last_at = now();
  insert into cards_upgrades (twitch_id, card_id, from_rarity, to_rarity, shiny) values (p_id, v[1], v[2], v_next, v_shiny);

  -- Legendary/Mythic auch beim Hochstufen im Stream zeigen
  if cards_rank(v_next) >= cfg.alert_min_rank then
    insert into cards_overlay_queue (twitch_id, display_name, card_id, rarity, shiny)
    values (p_id, u.display_name, v[1], v_next, v_shiny);
  end if;

  return jsonb_build_object('ok', true, 'used', cfg.upgrade_need - 1, 'new_variant', v_new_variant,
    'card', cards_card_json(v[1], v_next, v_shiny));
end $$;

-- ── Errungenschaften ────────────────────────────────────────────────────────
create table if not exists cards_achievements (
  code text primary key,
  sort int not null,
  icon text not null,
  name text not null,
  description text not null,
  stat text not null,
  goal int not null            -- 0 = Anzahl aller Herden-Karten (wächst mit der Herde)
);
create table if not exists cards_achievement_unlocks (
  twitch_id text not null references cards_users,
  code text not null references cards_achievements on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (twitch_id, code)
);
alter table cards_achievements enable row level security;
alter table cards_achievement_unlocks enable row level security;

insert into cards_achievements (code, sort, icon, name, description, stat, goal) values
  ('first_pack',  10, '🎁', 'Frischling',          'Öffne dein erstes Pack.',                              'packs',     1),
  ('packs_25',    11, '📦', 'Pack-Ratte',          'Öffne 25 Packs.',                                      'packs',    25),
  ('packs_100',   12, '🐪', 'Packesel',            'Öffne 100 Packs.',                                     'packs',   100),
  ('cards_25',    20, '🃏', 'Sammler',             'Sammle 25 verschiedene Karten.',                       'cards',    25),
  ('cards_75',    21, '📚', 'Halbes Album',        'Sammle 75 verschiedene Karten.',                       'cards',    75),
  ('cards_150',   22, '🏆', 'Komplett!',           'Sammle alle 150 Karten.',                              'cards',   150),
  ('var_300',     23, '💎', 'Versionen-Jäger',     'Sammle 300 verschiedene Versionen.',                   'variants', 300),
  ('var_900',     24, '👑', 'Vollendet',           'Sammle alle 900 Versionen.',                           'variants', 900),
  ('set_animals', 30, '🦒', 'Safari',              'Sammle alle 20 Savannentiere.',                        'animals',  20),
  ('set_setup',   31, '🎙️', 'Voll ausgestattet',   'Sammle alle 40 Setup-Karten.',                         'setup',    40),
  ('set_herd',    32, '🦌', 'Die ganze Herde',     'Sammle alle Herdenmitglieder.',                        'herd',      0),
  ('boss',        33, '🎮', 'Der Boss',            'Ziehe die Karte von Mr27cent (#001).',                 'boss',      1),
  ('rainbow',     34, '🎨', 'Regenbogen',          'Besitze eine Karte in allen 6 Seltenheiten.',          'rainbow',   6),
  ('epic',        40, '🔮', 'Episch!',             'Besitze eine Epic-Karte.',                             'epic',      1),
  ('legendary',   41, '🌟', 'Legende',             'Besitze eine Legendary-Karte.',                        'legendary', 1),
  ('mythic',      42, '🌈', 'Mythos',              'Besitze eine Mythic-Karte.',                           'mythic',    1),
  ('shiny_1',     43, '✨', 'Glitzer',             'Besitze eine Shiny-Karte.',                            'shinies',   1),
  ('shiny_10',    44, '💫', 'Funkelregen',         'Besitze 10 verschiedene Shinys.',                      'shinies',  10),
  ('upgrade_1',   50, '⬆️', 'Aufsteiger',          'Stufe eine Karte hoch.',                               'upgrades',  1),
  ('upgrade_25',  51, '🔨', 'Kartenschmied',       'Stufe 25 Karten hoch.',                                'upgrades', 25),
  ('trade_1',     60, '🤝', 'Handschlag',          'Schließe deinen ersten Tausch ab.',                    'trades',    1),
  ('trade_10',    61, '🔄', 'Händler',             'Schließe 10 Tausche ab.',                              'trades',   10),
  ('selfie',      70, '🤳', 'Selfie',              'Besitze deine eigene Herden-Karte.',                   'selfie',    1),
  ('famous',      71, '⭐', 'Berühmt',             'Deine Herden-Karte wurde 25× von anderen gezogen.',    'famous',   25)
on conflict (code) do update set sort = excluded.sort, icon = excluded.icon, name = excluded.name,
  description = excluded.description, stat = excluded.stat, goal = excluded.goal;

-- Alle Zahlen eines Spielers, aus denen sich die Errungenschaften ergeben
create or replace function cards_player_stats(p_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  with inv as (
    select i.card_id, i.rarity, i.shiny, c.number, c.kind
    from cards_inventory i join cards_catalog c on c.id = i.card_id
    where i.twitch_id = p_id and i.qty > 0 and c.series = 1
  ), mine as (select id from cards_catalog where kind = 'person' and twitch_id = p_id limit 1)
  select jsonb_build_object(
    'packs',     (select count(*) from cards_packs where twitch_id = p_id and opened_at is not null),
    'cards',     (select count(distinct card_id) from inv),
    'variants',  (select count(distinct (card_id, rarity)) from inv),
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
    'famous',    (select count(*) from cards_pulls where card_id in (select id from mine) and twitch_id <> p_id))
$$;

create or replace function cards_ach_goal(a cards_achievements)
returns int language sql stable set search_path = public as $$
  select case when a.goal = 0 then (select count(*)::int from cards_catalog where series = 1 and kind = 'person') else a.goal end
$$;

-- Neu erreichte Errungenschaften eintragen; gibt die neuen zurück (für die Meldung „Errungenschaft freigeschaltet“)
create or replace function cards_ach_sync(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s jsonb; v_new jsonb;
begin
  if p_id is null or not exists (select 1 from cards_users where twitch_id = p_id) then return '[]'; end if;
  s := cards_player_stats(p_id);
  with ins as (
    insert into cards_achievement_unlocks (twitch_id, code)
    select p_id, a.code from cards_achievements a
    where coalesce((s ->> a.stat)::int, 0) >= cards_ach_goal(a)
    on conflict do nothing
    returning code
  )
  select coalesce(jsonb_agg(jsonb_build_object('code', a.code, 'icon', a.icon, 'name', a.name) order by a.sort), '[]')
  into v_new from ins join cards_achievements a on a.code = ins.code;
  return v_new;
end $$;

-- Liste für ein Album: Fortschritt, Datum, und wie viel % aller Sammler sie haben (wie bei Steam)
create or replace function cards_achievements_of(p_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  with s as (select cards_player_stats(p_id) j),
  n as (select greatest(count(distinct i.twitch_id), 1) total from cards_inventory i
        join cards_users u on u.twitch_id = i.twitch_id where i.qty > 0 and not u.hidden)
  select coalesce(jsonb_agg(jsonb_build_object(
      'code', a.code, 'icon', a.icon, 'name', a.name, 'description', a.description,
      'goal', cards_ach_goal(a),
      'value', least(coalesce((s.j ->> a.stat)::int, 0), cards_ach_goal(a)),
      'unlocked_at', ul.unlocked_at,
      'percent', round(100.0 * (select count(*) from cards_achievement_unlocks x
                                join cards_users u on u.twitch_id = x.twitch_id
                                where x.code = a.code and not u.hidden) / n.total)
    ) order by a.sort), '[]')
  from cards_achievements a cross join s cross join n
  left join cards_achievement_unlocks ul on ul.twitch_id = p_id and ul.code = a.code
$$;

-- ── „Deine Karte wurde gezogen“ ─────────────────────────────────────────────
-- Wie oft andere eine Karte gezogen haben und wie viele Sammler sie besitzen
create or replace function cards_card_stats(p_card text)
returns jsonb language sql stable security definer set search_path = public as $$
  with c as (select id, number, name, kind, twitch_id from cards_catalog
             where id = coalesce((cards_parse_variant(p_card))[1], cards_card_id(p_card)))
  select case when c.id is null then jsonb_build_object('ok', false) else jsonb_build_object(
    'ok', true, 'card', c.id, 'number', c.number, 'name', c.name, 'kind', c.kind,
    'pulls', (select count(*) from cards_pulls p where p.card_id = c.id
              and p.twitch_id is distinct from c.twitch_id),
    'collectors', (select count(distinct i.twitch_id) from cards_inventory i join cards_users u on u.twitch_id = i.twitch_id
                   where i.card_id = c.id and i.qty > 0 and not u.hidden)) end
  from (select 1) one left join c on true
$$;

-- Album-Zusatz: Herden-Karte des Album-Besitzers + Errungenschaften
create or replace function cards_album_extra(p_login text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'my_card', (select cards_card_stats(c.id) from cards_catalog c
                where c.kind = 'person' and c.twitch_id = u.twitch_id limit 1),
    'achievements', cards_achievements_of(u.twitch_id))
  from cards_users u where lower(u.login) = lower(ltrim(trim(p_login), '@'))
$$;

create or replace function public.cards_album_public(p_login text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when (a ->> 'ok')::boolean then a || coalesce(cards_album_extra(p_login), '{}') else a end
  from (select cards_album(p_login, null) a) x
$$;

create or replace function public.cards_web_album(p_login text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_id text := cards_auth_user(); v_login text; a jsonb;
begin
  v_login := coalesce(nullif(p_login, ''), (select login from cards_users where twitch_id = v_id));
  perform cards_ach_sync(v_id);
  a := cards_album(v_login, v_id);
  if (a ->> 'ok')::boolean then a := a || coalesce(cards_album_extra(v_login), '{}'); end if;
  return a;
end $$;

-- ── Web: neue Aktionen + Meldung neuer Errungenschaften ─────────────────────
create or replace function public.cards_web_upgrade(p_version text, p_shiny boolean) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_id text := cards_auth_user(); r jsonb;
begin
  r := cards_upgrade(v_id, p_version, p_shiny);
  return r || jsonb_build_object('achievements', cards_ach_sync(v_id));
end $$;

create or replace function public.cards_web_open(p_pack_id bigint) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_id text := cards_auth_user(); r jsonb;
begin
  if not exists (select 1 from cards_packs where id = p_pack_id and twitch_id = v_id) then
    return jsonb_build_object('ok', false, 'reason', 'kein_pack');
  end if;
  r := cards_open_pack(p_pack_id);
  return r || jsonb_build_object('achievements', cards_ach_sync(v_id));
end $$;

create or replace function public.cards_web_trade_respond(p_trade_id bigint, p_accept boolean) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_id text := cards_auth_user(); r jsonb;
begin
  r := cards_trade_respond(p_trade_id, v_id, p_accept);
  return r || jsonb_build_object('achievements', cards_ach_sync(v_id));
end $$;

-- ── Rechte ───────────────────────────────────────────────────────────────────
revoke all on function cards_upgrade(text, text, boolean) from public, anon, authenticated;
revoke all on function cards_player_stats(text) from public, anon, authenticated;
revoke all on function cards_ach_goal(cards_achievements) from public, anon, authenticated;
revoke all on function cards_ach_sync(text) from public, anon, authenticated;
revoke all on function cards_achievements_of(text) from public, anon, authenticated;
revoke all on function cards_album_extra(text) from public, anon, authenticated;
revoke all on function cards_web_upgrade(text, boolean) from public, anon;
grant execute on function cards_web_upgrade(text, boolean) to authenticated;
revoke all on function cards_card_stats(text) from public;
grant execute on function cards_card_stats(text) to anon, authenticated;
grant execute on function cards_album_public(text) to anon, authenticated;

-- ── Nachtrag: Errungenschaften des Album-Besitzers beim Ansehen aktualisieren ──
drop function if exists public.cards_album_public(text);
create function public.cards_album_public(p_login text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare a jsonb;
begin
  a := cards_album(p_login, null);
  if (a ->> 'ok')::boolean then
    perform cards_ach_sync((select twitch_id from cards_users where lower(login) = lower(ltrim(trim(p_login), '@'))));
    a := a || coalesce(cards_album_extra(p_login), '{}');
  end if;
  return a;
end $$;
revoke all on function public.cards_album_public(text) from public;
grant execute on function public.cards_album_public(text) to anon, authenticated;

create or replace function public.cards_web_album(p_login text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_id text := cards_auth_user(); v_login text; a jsonb;
begin
  v_login := coalesce(nullif(p_login, ''), (select login from cards_users where twitch_id = v_id));
  perform cards_ach_sync(v_id);
  a := cards_album(v_login, v_id);
  if (a ->> 'ok')::boolean then
    perform cards_ach_sync((select twitch_id from cards_users where lower(login) = lower(ltrim(trim(v_login), '@'))));
    a := a || coalesce(cards_album_extra(v_login), '{}');
  end if;
  return a;
end $$;
