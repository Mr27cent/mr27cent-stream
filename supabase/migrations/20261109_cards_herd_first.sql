-- Herden-Karten: Tester-Daten von mr27cent auf 0, neue !herde-Leute dazu, Herde immer vor den Items
-- Die Nummer im Album ist jetzt unabhängig von der internen Karten-ID (S1-xxx bleibt fest),
-- damit neue Herdenmitglieder auch nach dem Start vor die Tiere rutschen können. Stand 09.11.2026

-- ── 1) Tester mr27cent komplett auf 0 ───────────────────────────────────────
do $$
declare v_id text := (select twitch_id from cards_users where login = 'mr27cent');
begin
  delete from cards_overlay_queue where twitch_id = v_id;
  delete from cards_trades where v_id in (from_id, to_id);
  delete from cards_display where twitch_id = v_id;
  delete from cards_inventory where twitch_id = v_id;
  delete from cards_pulls where twitch_id = v_id;
  delete from cards_weekly_claims where twitch_id = v_id;
  delete from cards_packs where twitch_id = v_id;
  delete from cards_upgrades where twitch_id = v_id;
  delete from cards_achievement_unlocks where twitch_id = v_id;
  delete from cards_event_copies where owner_id = v_id or first_owner_id = v_id;
  delete from cards_event_watch where twitch_id = v_id;
  update cards_users set total_minutes = 0, week_minutes = 0, week_start = null, watch_packs = 0,
                         starter_claimed_at = null
  where twitch_id = v_id;
end $$;

-- ── 2) Kategorie statt Nummernbereich ───────────────────────────────────────
alter table cards_catalog add column if not exists category text;
update cards_catalog set category = case
  when kind = 'person' then 'herd'
  when kind = 'event' then 'event'
  when number between 30 and 49 then 'animal'
  else 'setup' end
where category is null;

-- ── 3) Karte anlegen/ändern: nach Nummer im Album; neue Karten bekommen eine freie ID ──
create or replace function cards_new_card_id()
returns text language sql stable set search_path = public as $$
  select 'S1-' || lpad((coalesce(max(substring(id from 4)::int) filter (where substring(id from 4)::int < 900), 0) + 1)::text, 3, '0')
  from cards_catalog where id ~ '^S1-\d+$'
$$;

create or replace function cards_admin_set_card(p_number int, p_kind text, p_name text,
  p_login text default null, p_image text default null, p_flavor text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  if p_kind not in ('person', 'item', 'event') then raise exception 'kind muss person, item oder event sein'; end if;
  select id into v_id from cards_catalog where series = 1 and number = p_number;
  if v_id is null then
    v_id := case when p_kind = 'event' then 'S1-' || lpad(p_number::text, 3, '0') else cards_new_card_id() end;
    insert into cards_catalog (id, series, number, name, kind, in_packs, tradable)
    values (v_id, 1, p_number, coalesce(nullif(trim(p_name), ''), v_id), p_kind, p_kind <> 'event', true);
  end if;
  update cards_catalog set
    kind = p_kind,
    category = case p_kind when 'person' then 'herd' when 'event' then 'event' else coalesce(category, 'setup') end,
    name = coalesce(nullif(trim(p_name), ''), name),
    twitch_login = case when p_kind = 'person' then lower(ltrim(trim(p_login), '@')) end,
    twitch_id = case when p_kind = 'person' and lower(ltrim(trim(p_login), '@')) is not distinct from twitch_login then twitch_id end,
    avatar = case when p_kind = 'person' and lower(ltrim(trim(p_login), '@')) is not distinct from twitch_login then avatar end,
    avatar_checked_at = null,
    image = nullif(trim(p_image), ''),
    flavor = p_flavor,
    in_packs = p_kind <> 'event'
  where id = v_id;
  return jsonb_build_object('ok', true, 'card', v_id, 'number', p_number);
end $$;

-- Neues Herdenmitglied: kommt direkt hinter die letzte Herden-Karte, alle Items rücken eins nach hinten
create or replace function cards_admin_add_person(p_login text, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_login text := lower(ltrim(trim(p_login), '@')); v_nr int; v_id text;
begin
  if exists (select 1 from cards_catalog where kind = 'person' and twitch_login = v_login) then
    return jsonb_build_object('ok', false, 'reason', 'schon_da',
      'card', (select id from cards_catalog where kind = 'person' and twitch_login = v_login));
  end if;
  select coalesce(max(number), 0) + 1 into v_nr from cards_catalog where series = 1 and kind = 'person';
  -- Items nach hinten schieben (in zwei Schritten wegen der eindeutigen Nummer)
  update cards_catalog set number = number + 10000 where series = 1 and kind = 'item' and number >= v_nr;
  update cards_catalog set number = number - 10000 + 1 where series = 1 and kind = 'item' and number >= 10000;
  v_id := cards_new_card_id();
  insert into cards_catalog (id, series, number, name, kind, category, in_packs, tradable, twitch_login)
  values (v_id, 1, v_nr, coalesce(nullif(trim(p_name), ''), v_login), 'person', 'herd', true, true, v_login);
  return jsonb_build_object('ok', true, 'card', v_id, 'number', v_nr);
end $$;

-- ── 4) Neue Leute + Reihenfolge: #001 Mr27cent, dann Herde nach Zuschauzeit, dann Tiere, dann Setup ──
-- Neue Herdenmitglieder (bekommen freie IDs; Profilbild holt cards-tick)
insert into cards_catalog (id, series, number, name, kind, category, in_packs, tradable, twitch_login)
select cards_new_card_id(), 1, 5000, 'D0PED0ME', 'person', 'herd', true, true, 'd0ped0me';
insert into cards_catalog (id, series, number, name, kind, category, in_packs, tradable, twitch_login)
select cards_new_card_id(), 1, 5001, 'HerrMuuh', 'person', 'herd', true, true, 'herrmuuh';
insert into cards_catalog (id, series, number, name, kind, category, in_packs, tradable, twitch_login)
select cards_new_card_id(), 1, 5002, 'benkatchu', 'person', 'herd', true, true, 'benkatchu';
insert into cards_catalog (id, series, number, name, kind, category, in_packs, tradable, twitch_login)
select cards_new_card_id(), 1, 5003, 'Shandorie', 'person', 'herd', true, true, 'shandorie';
insert into cards_catalog (id, series, number, name, kind, category, in_packs, tradable, twitch_login)
select cards_new_card_id(), 1, 5004, 'va7_leon', 'person', 'herd', true, true, 'va7_leon';

-- Alle Nummern (außer Event-Karten) erst aus dem Weg, dann neu vergeben
update cards_catalog set number = number + 10000 where series = 1 and kind <> 'event';
with herd(login, pos) as (
  select * from unnest(array['mr27cent', 'flyinglinkachu', 'in_luce', 'xbopf', 'chaos_queen_97', 'paulinius27',
    'anteez1', 'nym3ria_', 'banarnenweizen', 'glatzenfefe', 'batmandy16', 'hahni_rl', 'sy_energii', 'juggermaxi',
    'tompokc137', 'lilymkc', 'itsceddiii', 'd0ped0me', 'peakpikarlcs', 'domi_nik2601', 'blubb3r', 'endiiii__',
    'g9nzo85', 'therealplayperfect', 'herrmuuh', 'pt_cozy', 'almortyy', 'zyldarrl', 'benkatchu', 'weaslebee7',
    'cracxsed', 'shandorie', 'va7_leon', 'ue_baba']) with ordinality
),
persons as (
  select c.id, row_number() over (order by coalesce(h.pos, 1000), c.number) n
  from cards_catalog c left join herd h on h.login = c.twitch_login
  where c.series = 1 and c.kind = 'person'
),
items as (
  select c.id, row_number() over (order by case c.category when 'animal' then 0 else 1 end, c.number) n
  from cards_catalog c where c.series = 1 and c.kind = 'item'
)
update cards_catalog c set number = x.n
from (select id, n from persons
      union all select id, n + (select count(*) from persons) from items) x
where c.id = x.id;

-- ── 5) Errungenschaften: Tiere/Setup nach Kategorie, Boss = Karte von Mr27cent ──
create or replace function cards_player_stats(p_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  with inv as (
    select i.card_id, i.rarity, i.shiny, c.number, c.kind, c.category, c.in_packs, c.twitch_login
    from cards_inventory i join cards_catalog c on c.id = i.card_id
    where i.twitch_id = p_id and i.qty > 0 and c.series = 1
  ), mine as (select id from cards_catalog where kind = 'person' and twitch_id = p_id limit 1)
  select jsonb_build_object(
    'packs',     (select count(*) from cards_packs where twitch_id = p_id and opened_at is not null),
    'cards',     (select count(distinct card_id) from inv where in_packs),
    'variants',  (select count(distinct (card_id, rarity)) from inv where in_packs),
    'animals',   (select count(distinct card_id) from inv where category = 'animal'),
    'setup',     (select count(distinct card_id) from inv where category = 'setup'),
    'herd',      (select count(distinct card_id) from inv where kind = 'person'),
    'boss',      (select count(*) from inv where twitch_login = 'mr27cent'),
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

revoke all on function cards_new_card_id() from public, anon, authenticated;
revoke all on function cards_admin_set_card(int, text, text, text, text, text) from public, anon, authenticated;
revoke all on function cards_admin_add_person(text, text) from public, anon, authenticated;
