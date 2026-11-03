-- ═══════════════════════════════════════════════════════════════════════════
--  Herden-Karten · Phase 4: Funktionen für die Webseite (#karten)
--  Eingeloggte Zuschauer (Supabase Auth, Anbieter Twitch) handeln immer als sie
--  selbst – die Twitch-ID kommt aus dem Login, nie aus dem Browser.
-- ═══════════════════════════════════════════════════════════════════════════

-- Wer nur zuschaut, hat kein öffentliches Album (wie die anonyme Herde).
-- Sichtbar wird es erst, wenn man selbst Karten hat.
create or replace function public.cards_album(p_login text, p_viewer text default null) returns jsonb
language sql stable security definer set search_path = public as $$
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

-- ── Login ────────────────────────────────────────────────────────────────────

-- Twitch-ID des eingeloggten Nutzers; legt den Spieler an bzw. aktualisiert den Namen
create function public.cards_auth_user() returns text
language plpgsql volatile security definer set search_path = public as $$
declare v_id text; d jsonb;
begin
  select i.provider_id, i.identity_data into v_id, d
  from auth.identities i where i.user_id = auth.uid() and i.provider = 'twitch' limit 1;
  if v_id is null then
    raise exception 'Bitte mit Twitch anmelden' using errcode = '28000';
  end if;
  perform cards_touch_user(v_id,
    coalesce(nullif(d->>'slug', ''), lower(d->>'nickname')),
    coalesce(nullif(d->>'nickname', ''), d->>'name', d->>'slug'));
  return v_id;
end $$;

-- ── Lesen ────────────────────────────────────────────────────────────────────

-- Alles für die Kopfzeile „Mein Konto“
create function public.cards_web_me() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id text := cards_auth_user();
  cfg cards_config;
  v_week date := cards_week_start();
begin
  select * into cfg from cards_config where id = 1;
  return cards_status(v_id) || jsonb_build_object(
    'twitch_id', v_id,
    'open', cards_is_open(v_id),
    'launch_at', cfg.launch_at,
    'weekly_min_minutes', cfg.weekly_min_minutes,
    'weekly_claimed', exists (select 1 from cards_weekly_claims where twitch_id = v_id and week_start = v_week and kind = 'free'),
    'next_week', v_week + 7,
    'trades_today', cards_trades_today(v_id),
    'trades_per_day', cfg.trades_per_day,
    'incoming_trades', (select count(*) from cards_trades
                        where to_id = v_id and status = 'pending' and expires_at >= now()),
    'packs', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'source', source) order by id)
                       from cards_packs where twitch_id = v_id and opened_at is null), '[]'));
end $$;

create function public.cards_web_album(p_login text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_id text := cards_auth_user();
begin
  return cards_album(coalesce(nullif(p_login, ''), (select login from cards_users where twitch_id = v_id)), v_id);
end $$;

create function public.cards_web_trades() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_id text := cards_auth_user();
begin
  perform cards_expire_trades();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'status', t.status, 'source', t.source,
      'incoming', t.to_id = v_id,
      'partner', case when t.to_id = v_id then f.display_name else o.display_name end,
      'partner_login', case when t.to_id = v_id then f.login else o.login end,
      'offer', cards_card_json(t.offer_card), 'want', cards_card_json(t.want_card),
      'created_at', t.created_at, 'expires_at', t.expires_at, 'decided_at', t.decided_at
    ) order by (t.status = 'pending') desc, t.created_at desc)
    from (select * from cards_trades
          where (from_id = v_id or to_id = v_id)
            and (status = 'pending' or decided_at > now() - interval '7 days')
          order by created_at desc limit 40) t
    join cards_users f on f.twitch_id = t.from_id
    join cards_users o on o.twitch_id = t.to_id), '[]');
end $$;

-- ── Aktionen ─────────────────────────────────────────────────────────────────

create function public.cards_web_claim_starter() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_id text := cards_auth_user(); u cards_users;
begin
  select * into u from cards_users where twitch_id = v_id;
  return cards_claim_starter(v_id, u.login, u.display_name);
end $$;

-- Auf der Webseite gibt es nur das normale Gratis-Pack. Das 2. Pack für Subs
-- holt man mit !freepack im Chat (dort prüft der Bot den Sub-Status bei Twitch).
create function public.cards_web_claim_weekly() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_id text := cards_auth_user(); u cards_users;
begin
  select * into u from cards_users where twitch_id = v_id;
  return cards_claim_weekly(v_id, u.login, u.display_name, false);
end $$;

create function public.cards_web_open(p_pack_id bigint) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_id text := cards_auth_user();
begin
  if not exists (select 1 from cards_packs where id = p_pack_id and twitch_id = v_id) then
    return jsonb_build_object('ok', false, 'reason', 'kein_pack');
  end if;
  return cards_open_pack(p_pack_id);
end $$;

create function public.cards_web_trade_offer(p_to_login text, p_offer text, p_want text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  return cards_trade_offer(cards_auth_user(), p_to_login, p_offer, p_want, 'web');
end $$;

create function public.cards_web_trade_respond(p_trade_id bigint, p_accept boolean) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  return cards_trade_respond(p_trade_id, cards_auth_user(), p_accept);
end $$;

create function public.cards_web_trade_cancel(p_trade_id bigint) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  return cards_trade_cancel(p_trade_id, cards_auth_user());
end $$;

create function public.cards_web_set_display(p_card text, p_shiny boolean) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  return cards_set_display(cards_auth_user(), p_card, p_shiny);
end $$;

create function public.cards_web_set_hidden(p_hidden boolean) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  return cards_set_hidden(cards_auth_user(), p_hidden);
end $$;

-- ── Öffentlich ───────────────────────────────────────────────────────────────

-- Start, Seltenheiten, Stufen und Zahlen für Countdown und Chancen-Rechner
create function public.cards_public_info() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'launch_at', c.launch_at,
    'shiny_factor', c.shiny_factor,
    'packs_per_stream', c.points_packs_per_stream,
    'price', c.points_price,
    'total', (select count(*) from cards_catalog where series = 1),
    'rarities', (select jsonb_agg(jsonb_build_object('code', code, 'rank', rank, 'name', name, 'count', card_count) order by rank)
                 from cards_rarities),
    'stages', (select jsonb_agg(jsonb_build_object('stage', stage, 'minutes', min_minutes, 'name', name) order by stage)
               from cards_stages),
    'collectors', (select count(distinct i.twitch_id) from cards_inventory i
                   join cards_users u on u.twitch_id = i.twitch_id where i.qty > 0 and not u.hidden))
  from cards_config c where c.id = 1
$$;

-- Namenssuche für „Alben ansehen“ und Tauschpartner (nur sichtbare Sammler)
create function public.cards_search_users(p_query text) returns table (login text, name text)
language sql stable security definer set search_path = public as $$
  select u.login, u.display_name from cards_users u
  where length(trim(coalesce(p_query, ''))) >= 2
    and lower(u.login) like lower(replace(replace(trim(p_query), '%', ''), '_', '\_')) || '%'
    and not u.hidden
    and exists (select 1 from cards_inventory i where i.twitch_id = u.twitch_id and i.qty > 0)
  order by u.login limit 10
$$;

-- ── Rechte ───────────────────────────────────────────────────────────────────

do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and (p.proname like 'cards\_web\_%' or p.proname in ('cards_auth_user', 'cards_public_info', 'cards_search_users', 'cards_album')) loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
  for f in select p.oid::regprocedure sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname like 'cards\_web\_%' loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

grant execute on function public.cards_public_info() to anon, authenticated;
grant execute on function public.cards_search_users(text) to anon, authenticated;
