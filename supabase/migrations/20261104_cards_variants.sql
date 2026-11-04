-- Herden-Karten: Jede der 150 Karten gibt es in allen 6 Seltenheiten (+ jeweils Shiny).
-- Die Seltenheit gehört jetzt zur gezogenen Karte, nicht mehr zum Motiv.
-- Im Album hat jede Karte einen Platz; gezeigt wird die seltenste Version
-- (oder die, die man selbst ausgewählt hat). Karten können Personen (Twitch-Profilbild)
-- oder Items sein.

-- ── Tabellen ─────────────────────────────────────────────────────────────────
alter table cards_catalog add column if not exists kind text not null default 'item'
  check (kind in ('person', 'item'));
alter table cards_catalog add column if not exists twitch_login text;
alter table cards_catalog add column if not exists twitch_id text;
alter table cards_catalog add column if not exists avatar text;
alter table cards_catalog add column if not exists avatar_checked_at timestamptz;

-- Seltenheit an jede Zeile hängen (bestehende Testdaten behalten ihre alte Seltenheit)
alter table cards_inventory add column if not exists rarity text references cards_rarities(code);
alter table cards_pulls add column if not exists rarity text references cards_rarities(code);
alter table cards_overlay_queue add column if not exists rarity text references cards_rarities(code);
alter table cards_trades add column if not exists rarity text references cards_rarities(code);
alter table cards_display add column if not exists rarity text references cards_rarities(code);

update cards_inventory i set rarity = c.rarity from cards_catalog c where c.id = i.card_id and i.rarity is null;
update cards_pulls i set rarity = c.rarity from cards_catalog c where c.id = i.card_id and i.rarity is null;
update cards_overlay_queue i set rarity = c.rarity from cards_catalog c where c.id = i.card_id and i.rarity is null;
update cards_trades i set rarity = c.rarity from cards_catalog c where c.id = i.offer_card and i.rarity is null;
delete from cards_display;

alter table cards_inventory alter column rarity set not null;
alter table cards_pulls alter column rarity set not null;
alter table cards_overlay_queue alter column rarity set not null;
alter table cards_trades alter column rarity set not null;

alter table cards_inventory drop constraint cards_inventory_pkey;
alter table cards_inventory add primary key (twitch_id, card_id, rarity, shiny);

-- Das Motiv hat keine feste Seltenheit mehr
alter table cards_catalog drop constraint if exists cards_catalog_rarity_fkey;
alter table cards_catalog drop column rarity;
update cards_rarities set card_count = (select count(*) from cards_catalog where series = 1);

-- ── Alte Funktionen mit geänderter Signatur entfernen ────────────────────────
drop function if exists cards_card_json(text, boolean);
drop function if exists cards_qty(text, text);
drop function if exists cards_pick_card(text, text[]);

-- ── Hilfen ───────────────────────────────────────────────────────────────────
-- Karte + Seltenheit aus Text: "S1-017-L", "017-L", "17L", "#17 legendary" → {S1-017, L}
create or replace function cards_parse_variant(p_text text)
returns text[] language plpgsql stable set search_path = public as $$
declare m text[]; v_card text; v_rar text;
begin
  m := regexp_match(lower(trim(coalesce(p_text, ''))),
    '^(?:s1-)?#?0*(\d{1,3})[\s\-_]*(c|u|r|e|l|m|common|uncommon|rare|epic|legendary|mythic)$');
  if m is null then return null; end if;
  select id into v_card from cards_catalog where series = 1 and number = m[1]::int;
  select code into v_rar from cards_rarities where lower(code) = m[2] or lower(name) = m[2];
  if v_card is null or v_rar is null then return null; end if;
  return array[v_card, v_rar];
end $$;

create or replace function cards_rank(p_rarity text)
returns int language sql stable set search_path = public as $$
  select rank from cards_rarities where code = p_rarity
$$;

create or replace function cards_card_image(c cards_catalog)
returns text language sql stable set search_path = public as $$
  select coalesce(c.image, case when c.kind = 'person' then c.avatar end)
$$;

create or replace function cards_card_json(p_card text, p_rarity text, p_shiny boolean default false)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('id', c.id || '-' || r.code, 'card', c.id, 'number', c.number, 'name', c.name,
                            'kind', c.kind, 'image', cards_card_image(c),
                            'rarity', r.code, 'rarity_name', r.name, 'shiny', coalesce(p_shiny, false))
  from cards_catalog c, cards_rarities r where c.id = p_card and r.code = p_rarity
$$;

create or replace function cards_qty(p_id text, p_card text, p_rarity text)
returns int language sql stable set search_path = public as $$
  select coalesce((select qty from cards_inventory
                   where twitch_id = p_id and card_id = p_card and rarity = p_rarity and not shiny), 0)
$$;

create or replace function cards_pick_card(p_exclude text[])
returns text language sql set search_path = public as $$
  select id from cards_catalog
  where in_packs and series = 1 and not (id = any (coalesce(p_exclude, '{}')))
  order by cards_rand() limit 1
$$;

-- ── Pack öffnen ──────────────────────────────────────────────────────────────
create or replace function cards_open_pack(p_pack_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p cards_packs;
  u cards_users;
  cfg cards_config;
  v_stage int;
  v_exclude text[] := '{}';
  v_min int;
  v_rarity text;
  v_card text;
  v_shiny boolean;
  v_new boolean;
  v_new_variant boolean;
  v_out jsonb := '[]';
  i int;
begin
  select * into p from cards_packs where id = p_pack_id for update;
  if not found then raise exception 'Pack % gibt es nicht', p_pack_id; end if;
  if p.opened_at is not null then return jsonb_build_object('ok', false, 'reason', 'schon_offen'); end if;

  select * into u from cards_users where twitch_id = p.twitch_id;
  select * into cfg from cards_config where id = 1;
  v_stage := cards_stage(u.total_minutes);

  -- Starter-Packs: nur Karten, die man noch gar nicht hat (egal in welcher Seltenheit)
  if p.no_dupes then
    select coalesce(array_agg(distinct card_id), '{}') into v_exclude
    from cards_inventory where twitch_id = p.twitch_id and qty > 0;
  end if;

  for i in 1..5 loop
    v_min := case when i = 5
      then greatest(3, coalesce(cards_rank(p.guarantee), 3))
      else 1 end;
    v_rarity := cards_pick_rarity(v_stage, v_min);
    v_card := cards_pick_card(case when p.no_dupes then v_exclude else '{}' end);
    if v_card is null then v_card := cards_pick_card('{}'); end if;
    v_exclude := v_exclude || v_card;
    v_shiny := cards_rand() < cfg.shiny_factor;
    v_new := not exists (select 1 from cards_inventory
                         where twitch_id = p.twitch_id and card_id = v_card and qty > 0);
    v_new_variant := not exists (select 1 from cards_inventory
                         where twitch_id = p.twitch_id and card_id = v_card and rarity = v_rarity
                           and shiny = v_shiny and qty > 0);

    insert into cards_pulls (pack_id, twitch_id, slot, card_id, rarity, shiny)
    values (p.id, p.twitch_id, i, v_card, v_rarity, v_shiny);
    insert into cards_inventory (twitch_id, card_id, rarity, shiny, qty)
    values (p.twitch_id, v_card, v_rarity, v_shiny, 1)
    on conflict (twitch_id, card_id, rarity, shiny)
      do update set qty = cards_inventory.qty + 1, last_at = now();

    if v_shiny or cards_rank(v_rarity) >= cfg.alert_min_rank then
      insert into cards_overlay_queue (twitch_id, display_name, card_id, rarity, shiny)
      values (p.twitch_id, u.display_name, v_card, v_rarity, v_shiny);
    end if;

    v_out := v_out || (cards_card_json(v_card, v_rarity, v_shiny)
      || jsonb_build_object('slot', i, 'new', v_new, 'new_variant', v_new_variant));
  end loop;

  update cards_packs set opened_at = now(), stage_at_open = v_stage where id = p.id;
  return jsonb_build_object('ok', true, 'pack', p.id, 'source', p.source, 'stage', v_stage,
                            'name', u.display_name, 'cards', v_out);
end $$;

-- ── Album: ein Platz pro Karte, gezeigt wird die gewählte oder seltenste Version ──
create or replace function cards_album(p_login text, p_viewer text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when u.twitch_id is null then jsonb_build_object('ok', false, 'reason', 'unbekannt')
    when u.twitch_id is distinct from p_viewer
         and not exists (select 1 from cards_inventory where twitch_id = u.twitch_id and qty > 0)
      then jsonb_build_object('ok', false, 'reason', 'unbekannt')
    when u.hidden and u.twitch_id is distinct from p_viewer then jsonb_build_object('ok', false, 'reason', 'versteckt')
    else jsonb_build_object(
      'ok', true,
      'name', u.display_name,
      'login', u.login,
      'stage', cards_stage(u.total_minutes),
      'hidden', u.hidden,
      'cards', (
        select jsonb_agg(jsonb_build_object(
          'id', c.id, 'number', c.number, 'kind', c.kind,
          'name', case when v.owned then c.name end,
          'image', case when v.owned then cards_card_image(c) end,
          'rarity', sh.rarity,
          'show_shiny', coalesce(sh.shiny, false),
          'chosen', d.rarity is not null and sh.rarity = d.rarity,
          'qty', coalesce(v.qty, 0),
          'shiny_qty', coalesce(v.shiny_qty, 0),
          'variants', coalesce(v.list, '[]'::jsonb)
        ) order by c.number)
        from cards_catalog c
        left join lateral (
          select bool_or(i.qty > 0) as owned,
                 sum(i.qty) filter (where not i.shiny) as qty,
                 sum(i.qty) filter (where i.shiny) as shiny_qty,
                 jsonb_agg(jsonb_build_object('r', i.rarity, 's', i.shiny, 'q', i.qty)
                           order by cards_rank(i.rarity), i.shiny) as list
          from cards_inventory i
          where i.twitch_id = u.twitch_id and i.card_id = c.id and i.qty > 0
        ) v on true
        left join cards_display d on d.twitch_id = u.twitch_id and d.card_id = c.id
        left join lateral (
          select i.rarity, i.shiny from cards_inventory i
          where i.twitch_id = u.twitch_id and i.card_id = c.id and i.qty > 0
          order by (d.rarity is not null and i.rarity = d.rarity and i.shiny = d.show_shiny) desc,
                   cards_rank(i.rarity) desc, i.shiny desc
          limit 1
        ) sh on true
        where c.series = 1))
  end
  from (select 1) one
  left join cards_users u on lower(u.login) = lower(ltrim(trim(p_login), '@'))
$$;

-- Anzeige wählen: Version (z. B. "S1-017-L" + Shiny ja/nein) oder nur Karte = automatisch seltenste
create or replace function cards_set_display(p_id text, p_card text, p_shiny boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v text[] := cards_parse_variant(p_card); v_card text;
begin
  if v is null then
    v_card := cards_card_id(p_card);
    if v_card is null then return jsonb_build_object('ok', false, 'reason', 'karte_unbekannt'); end if;
    delete from cards_display where twitch_id = p_id and card_id = v_card;
    return jsonb_build_object('ok', true, 'auto', true, 'card', v_card);
  end if;
  if not exists (select 1 from cards_inventory
                 where twitch_id = p_id and card_id = v[1] and rarity = v[2] and shiny = coalesce(p_shiny, false) and qty > 0) then
    return jsonb_build_object('ok', false, 'reason', 'nicht_im_besitz', 'card', v[1]);
  end if;
  insert into cards_display (twitch_id, card_id, rarity, show_shiny) values (p_id, v[1], v[2], coalesce(p_shiny, false))
  on conflict (twitch_id, card_id) do update set rarity = excluded.rarity, show_shiny = excluded.show_shiny;
  return jsonb_build_object('ok', true, 'card', cards_card_json(v[1], v[2], coalesce(p_shiny, false)));
end $$;

-- Für den Chat-Bot: Infos zu einer Karte (mit oder ohne Seltenheit)
create or replace function cards_card_info(p_id text, p_card text)
returns jsonb language sql stable security definer set search_path = public as $$
  with k as (select coalesce((cards_parse_variant(p_card))[1], cards_card_id(p_card)) id)
  select case when k.id is null then jsonb_build_object('ok', false, 'reason', 'karte_unbekannt') else
    jsonb_build_object('ok', true, 'id', c.id, 'number', c.number, 'name', c.name, 'kind', c.kind,
      'variants', coalesce((select jsonb_agg(jsonb_build_object('r', i.rarity, 's', i.shiny, 'q', i.qty)
                                             order by cards_rank(i.rarity), i.shiny)
                            from cards_inventory i where i.twitch_id = p_id and i.card_id = c.id and i.qty > 0), '[]'))
  end
  from k left join cards_catalog c on c.id = k.id
$$;

-- ── Ranglisten & Status ─────────────────────────────────────────────────────
-- complete = Anzahl verschiedener Karten, shiny = verschiedene Shiny-Versionen,
-- mythic = verschiedene Karten in Mythic, variants = verschiedene Versionen (max. 900)
create or replace function cards_leaderboard(p_kind text, p_limit integer default 25)
returns table(place bigint, name text, login text, value bigint)
language sql stable security definer set search_path = public as $$
  with v as (
    select i.twitch_id,
      case p_kind
        when 'shiny' then count(distinct (i.card_id, i.rarity)) filter (where i.shiny)
        when 'mythic' then count(distinct i.card_id) filter (where i.rarity = 'M')
        when 'variants' then count(distinct (i.card_id, i.rarity))
        else count(distinct i.card_id) end as value
    from cards_inventory i
    where i.qty > 0
    group by i.twitch_id
  )
  select rank() over (order by v.value desc), u.display_name, u.login, v.value
  from v join cards_users u on u.twitch_id = v.twitch_id
  where not u.hidden and v.value > 0
  order by v.value desc, u.display_name
  limit least(greatest(p_limit, 1), 100)
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
      'collected', (select count(distinct card_id) from cards_inventory where twitch_id = u.twitch_id and qty > 0),
      'variants', (select count(distinct (card_id, rarity)) from cards_inventory where twitch_id = u.twitch_id and qty > 0),
      'shinies', (select count(distinct (card_id, rarity)) from cards_inventory where twitch_id = u.twitch_id and shiny and qty > 0),
      'total', (select count(*) from cards_catalog where series = 1),
      'variants_total', (select count(*) from cards_catalog where series = 1) * (select count(*) from cards_rarities),
      'hidden', u.hidden,
      'odds', (select jsonb_object_agg(code, chance) from cards_odds(s.stage, 1)))
  end
  from (select 1) one
  left join cards_users u on u.twitch_id = p_id
  left join cards_stages s on s.stage = cards_stage(u.total_minutes)
$$;

create or replace function cards_public_info()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'launch_at', c.launch_at,
    'shiny_factor', c.shiny_factor,
    'packs_per_stream', c.points_packs_per_stream,
    'price', c.points_price,
    'watch_pack_minutes', c.watch_pack_minutes,
    'total', (select count(*) from cards_catalog where series = 1),
    'persons', (select count(*) from cards_catalog where series = 1 and kind = 'person'),
    'items', (select count(*) from cards_catalog where series = 1 and kind = 'item'),
    'rarities', (select jsonb_agg(jsonb_build_object('code', code, 'rank', rank, 'name', name, 'count', card_count) order by rank)
                 from cards_rarities),
    'stages', (select jsonb_agg(jsonb_build_object('stage', stage, 'minutes', min_minutes, 'name', name) order by stage)
               from cards_stages),
    'collectors', (select count(distinct i.twitch_id) from cards_inventory i
                   join cards_users u on u.twitch_id = i.twitch_id where i.qty > 0 and not u.hidden))
  from cards_config c where c.id = 1
$$;

-- ── Tauschen: Karten-Version = Karte + Seltenheit, beide Seiten gleiche Seltenheit ──
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
  if v_offer[2] <> v_want[2] then return jsonb_build_object('ok', false, 'reason', 'andere_seltenheit'); end if;
  if cards_qty(p_from, v_offer[1], v_offer[2]) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'kein_duplikat_eigen', 'card', v_offer[1] || '-' || v_offer[2]);
  end if;
  if cards_qty(v_to.twitch_id, v_want[1], v_want[2]) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'kein_duplikat_partner', 'card', v_want[1] || '-' || v_want[2]);
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

  if cards_qty(t.from_id, t.offer_card, t.rarity) < 2 or cards_qty(t.to_id, t.want_card, t.rarity) < 2 then
    update cards_trades set status = 'cancelled', decided_at = now() where id = t.id;
    return jsonb_build_object('ok', false, 'reason', 'nicht_mehr_doppelt');
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

create or replace function cards_web_trades()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id text := cards_auth_user();
begin
  perform cards_expire_trades();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'status', t.status, 'source', t.source,
      'incoming', t.to_id = v_id,
      'partner', case when t.to_id = v_id then f.display_name else o.display_name end,
      'partner_login', case when t.to_id = v_id then f.login else o.login end,
      'offer', cards_card_json(t.offer_card, t.rarity), 'want', cards_card_json(t.want_card, t.rarity),
      'created_at', t.created_at, 'expires_at', t.expires_at, 'decided_at', t.decided_at
    ) order by (t.status = 'pending') desc, t.created_at desc)
    from (select * from cards_trades
          where (from_id = v_id or to_id = v_id)
            and (status = 'pending' or decided_at > now() - interval '7 days')
          order by created_at desc limit 40) t
    join cards_users f on f.twitch_id = t.from_id
    join cards_users o on o.twitch_id = t.to_id), '[]');
end $$;

-- Vorschläge: Partner hat eine Version doppelt, die mir fehlt – und braucht eine meiner doppelten
-- (gleiche Seltenheit). Karten, die mir ganz fehlen, zählen am meisten.
create or replace function cards_web_trade_suggestions()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id text := cards_auth_user();
begin
  return coalesce((
    with my_dupes as (
      select card_id, rarity from cards_inventory where twitch_id = v_id and not shiny and qty >= 2
    ),
    others as (
      select twitch_id, login, display_name from cards_users where twitch_id <> v_id and not hidden
    ),
    their_dupes as (
      select i.twitch_id, i.card_id, i.rarity,
             not exists (select 1 from cards_inventory m where m.twitch_id = v_id and m.card_id = i.card_id and m.qty > 0) as missing_card
      from cards_inventory i
      join others o on o.twitch_id = i.twitch_id
      where not i.shiny and i.qty >= 2
        and not exists (select 1 from cards_inventory m where m.twitch_id = v_id and m.card_id = i.card_id
                          and m.rarity = i.rarity and m.qty > 0)
    ),
    pairs as (
      select t.twitch_id, d.card_id as give, t.card_id as get, d.rarity, cards_rank(d.rarity) as rank, t.missing_card
      from my_dupes d
      join their_dupes t on t.rarity = d.rarity
      where not exists (select 1 from cards_inventory x
                        where x.twitch_id = t.twitch_id and x.card_id = d.card_id and x.rarity = d.rarity and x.qty > 0)
    ),
    ranked as (
      select p.*, row_number() over (partition by p.twitch_id order by p.missing_card desc, p.rank desc, p.get, p.give) as rn,
             count(*) over (partition by p.twitch_id) as cnt,
             max(p.rank + case when p.missing_card then 10 else 0 end) over (partition by p.twitch_id) as best
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

-- ── Overlay ──────────────────────────────────────────────────────────────────
create or replace function cards_overlay_feed(p_after bigint default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_events jsonb; v_last bigint;
begin
  select coalesce(max(id), 0) into v_last from cards_overlay_queue;
  if p_after is null then
    return jsonb_build_object('last', v_last, 'events', '[]'::jsonb);
  end if;
  select jsonb_agg(e order by id), max(id) into v_events, v_last
  from (
    select q.id, jsonb_build_object(
      'id', q.id,
      'name', case when u.hidden then 'Ein Herdenmitglied' else q.display_name end,
      'card', cards_card_json(q.card_id, q.rarity, q.shiny)) as e
    from cards_overlay_queue q
    left join cards_users u on u.twitch_id = q.twitch_id
    where q.id > p_after and q.created_at > now() - interval '10 minutes'
    order by q.id limit 10
  ) s;
  if v_events is null then
    select coalesce(max(id), p_after) into v_last from cards_overlay_queue;
  end if;
  return jsonb_build_object('last', greatest(coalesce(v_last, p_after), p_after), 'events', coalesce(v_events, '[]'::jsonb));
end $$;

-- ── Karten festlegen (nur Streamer/Admin über das Supabase-Dashboard oder Claude) ──
-- Person: p_kind = 'person', p_login = Twitch-Name (Profilbild holt cards-tick automatisch).
-- Item:   p_kind = 'item', p_image = eigenes Bild (Pfad auf der Webseite, z. B. img/karten/017.png).
create or replace function cards_admin_set_card(p_number int, p_kind text, p_name text,
  p_login text default null, p_image text default null, p_flavor text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id text := 'S1-' || lpad(p_number::text, 3, '0');
begin
  if p_kind not in ('person', 'item') then raise exception 'kind muss person oder item sein'; end if;
  update cards_catalog set
    kind = p_kind,
    name = coalesce(nullif(trim(p_name), ''), name),
    twitch_login = case when p_kind = 'person' then lower(ltrim(trim(p_login), '@')) end,
    twitch_id = case when p_kind = 'person' and lower(ltrim(trim(p_login), '@')) is not distinct from twitch_login then twitch_id end,
    avatar = case when p_kind = 'person' and lower(ltrim(trim(p_login), '@')) is not distinct from twitch_login then avatar end,
    avatar_checked_at = null,
    image = nullif(trim(p_image), ''),
    flavor = p_flavor
  where id = v_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'karte_unbekannt'); end if;
  return jsonb_build_object('ok', true, 'card', v_id);
end $$;

-- Für cards-tick: Personen, deren Profilbild (neu) geholt werden muss (täglich auffrischen)
create or replace function cards_avatar_todo()
returns table(id text, login text) language sql stable security definer set search_path = public as $$
  select id, twitch_login from cards_catalog
  where kind = 'person' and twitch_login is not null
    and (avatar is null or avatar_checked_at is null or avatar_checked_at < now() - interval '1 day')
  order by avatar_checked_at nulls first limit 100
$$;

create or replace function cards_avatar_save(p_rows jsonb)
returns int language sql security definer set search_path = public as $$
  with r as (select * from jsonb_to_recordset(p_rows) as x(login text, twitch_id text, avatar text))
  , upd as (
    update cards_catalog c set twitch_id = coalesce(r.twitch_id, c.twitch_id),
      avatar = coalesce(r.avatar, c.avatar), avatar_checked_at = now()
    from r where c.kind = 'person' and c.twitch_login = lower(r.login)
    returning 1)
  select count(*)::int from upd
$$;

-- ── Rechte: nur Service-Rolle (Edge Functions) für neue interne Funktionen ──
revoke execute on function cards_parse_variant(text), cards_rank(text), cards_card_image(cards_catalog),
  cards_card_json(text, text, boolean), cards_qty(text, text, text), cards_pick_card(text[]),
  cards_admin_set_card(int, text, text, text, text, text), cards_avatar_todo(), cards_avatar_save(jsonb)
  from public, anon, authenticated;
