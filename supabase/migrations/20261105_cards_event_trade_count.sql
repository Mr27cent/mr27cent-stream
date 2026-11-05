-- Herden-Karten: Event-Karten sind tauschbar. Jede Event-Karte ist ein Einzelstück mit Tausch-Zähler
-- (0 = Original, 1 = einmal getauscht, …). Stand 05.11.2026

create table if not exists cards_event_copies (
  id bigint generated always as identity primary key,
  card_id text not null references cards_catalog,
  rarity text not null references cards_rarities(code),
  shiny boolean not null,
  owner_id text not null references cards_users,
  first_owner_id text not null references cards_users,
  trade_count int not null default 0,
  acquired_at timestamptz not null default now()
);
create index if not exists cards_event_copies_owner on cards_event_copies (owner_id, card_id);
alter table cards_event_copies enable row level security;

update cards_catalog set tradable = true where kind = 'event';

create or replace function cards_admin_set_card(p_number int, p_kind text, p_name text,
  p_login text default null, p_image text default null, p_flavor text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id text := 'S1-' || lpad(p_number::text, 3, '0');
begin
  if p_kind not in ('person', 'item', 'event') then raise exception 'kind muss person, item oder event sein'; end if;
  insert into cards_catalog (id, series, number, name, kind, in_packs, tradable)
  values (v_id, 1, p_number, coalesce(nullif(trim(p_name), ''), v_id), p_kind, p_kind <> 'event', true)
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
    in_packs = p_kind <> 'event'
  where id = v_id;
  return jsonb_build_object('ok', true, 'card', v_id);
end $$;

-- Event-Karte vergeben: zusätzlich als Einzelstück (Original) festhalten
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
        update cards_events set ends_at = now() where id = e.id;
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
      insert into cards_event_copies (card_id, rarity, shiny, owner_id, first_owner_id)
      values (e.card_id, v_rar, v_shiny, p_id, p_id);
      update cards_event_watch set granted_at = now(), rarity = v_rar, shiny = v_shiny
      where event_id = e.id and twitch_id = p_id;
      if v_shiny or cards_rank(v_rar) >= cfg.alert_min_rank then
        insert into cards_overlay_queue (twitch_id, display_name, card_id, rarity, shiny)
        values (p_id, u.display_name, e.card_id, v_rar, v_shiny);
      end if;
    end if;
  end loop;
end $$;

-- Ein Event-Einzelstück wechselt den Besitzer und zählt +1
create or replace function cards_event_copy_move(p_card text, p_rarity text, p_from text, p_to text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from cards_catalog where id = p_card and kind = 'event') then return; end if;
  update cards_event_copies set owner_id = p_to, trade_count = trade_count + 1, acquired_at = now()
  where id = (select id from cards_event_copies
              where owner_id = p_from and card_id = p_card and rarity = p_rarity and not shiny
              order by acquired_at desc limit 1);
end $$;

-- Tauschen: wie bisher, Event-Karten wandern als Einzelstück mit Zähler mit
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
  perform cards_event_copy_move(t.offer_card, t.rarity, t.from_id, t.to_id);
  perform cards_event_copy_move(t.want_card, t.rarity, t.to_id, t.from_id);

  update cards_trades set status = 'accepted', decided_at = now() where id = t.id;
  return jsonb_build_object('ok', true, 'status', 'accepted', 'trade', t.id,
    'from', (select display_name from cards_users where twitch_id = t.from_id),
    'to', (select display_name from cards_users where twitch_id = t.to_id),
    'offer', cards_card_json(t.offer_card, t.rarity), 'want', cards_card_json(t.want_card, t.rarity));
end $$;

-- Hochstufen geht bei Event-Karten nicht (Einzelstücke)
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
  if exists (select 1 from cards_catalog where id = v[1] and kind = 'event') then
    return jsonb_build_object('ok', false, 'reason', 'event_einzelstueck');
  end if;
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

  if cards_rank(v_next) >= cfg.alert_min_rank then
    insert into cards_overlay_queue (twitch_id, display_name, card_id, rarity, shiny)
    values (p_id, u.display_name, v[1], v_next, v_shiny);
  end if;

  return jsonb_build_object('ok', true, 'used', cfg.upgrade_need - 1, 'new_variant', v_new_variant,
    'card', cards_card_json(v[1], v_next, v_shiny));
end $$;

-- Album-Zusatz: Event-Einzelstücke mit Tausch-Zähler
create or replace function cards_album_extra(p_login text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'my_card', (select cards_card_stats(c.id) from cards_catalog c
                where c.kind = 'person' and c.twitch_id = u.twitch_id limit 1),
    'achievements', cards_achievements_of(u.twitch_id),
    'event_copies', coalesce((select jsonb_agg(jsonb_build_object('card', x.card_id, 'r', x.rarity, 's', x.shiny,
                                                                 'trades', x.trade_count) order by x.trade_count)
                              from cards_event_copies x where x.owner_id = u.twitch_id), '[]'))
  from cards_users u where lower(u.login) = lower(ltrim(trim(p_login), '@'))
$$;

revoke all on function cards_event_copy_move(text, text, text, text) from public, anon, authenticated;
revoke all on function cards_event_tick(text, int, text) from public, anon, authenticated;
revoke all on function cards_album_extra(text) from public, anon, authenticated;

-- Nachtrag: Hat jemand mehrere gleiche Event-Karten, wird zuerst eine eingetauschte abgegeben (Original bleibt)
create or replace function cards_event_copy_move(p_card text, p_rarity text, p_from text, p_to text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from cards_catalog where id = p_card and kind = 'event') then return; end if;
  update cards_event_copies set owner_id = p_to, trade_count = trade_count + 1, acquired_at = now()
  where id = (select id from cards_event_copies
              where owner_id = p_from and card_id = p_card and rarity = p_rarity and not shiny
              order by (first_owner_id = p_from and trade_count = 0), acquired_at desc, id desc limit 1);
end $$;
revoke all on function cards_event_copy_move(text, text, text, text) from public, anon, authenticated;
