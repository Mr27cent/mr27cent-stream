-- ═══════════════════════════════════════════════════════════════════════════
--  Herden-Karten: Tauschvorschläge für die Webseite
--  Findet Sammler, die eine Karte doppelt haben, die mir ganz fehlt, und denen
--  eine meiner doppelten Karten derselben Seltenheit fehlt (beide Seiten
--  gewinnen also eine neue Karte). Shinys und versteckte Alben bleiben außen vor.
--  Pro Partner max. 4 Vorschläge, max. 12 Partner, seltenere Tausche zuerst.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.cards_web_trade_suggestions() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_id text := cards_auth_user();
begin
  return coalesce((
    with mine as (
      select card_id, sum(qty) filter (where not shiny) as normal, sum(qty) as total
      from cards_inventory where twitch_id = v_id group by card_id
    ),
    my_dupes as (
      select m.card_id, c.rarity from mine m join cards_catalog c on c.id = m.card_id where m.normal >= 2
    ),
    others as (
      select twitch_id, login, display_name from cards_users where twitch_id <> v_id and not hidden
    ),
    their_dupes as (
      select i.twitch_id, i.card_id, c.rarity
      from cards_inventory i
      join cards_catalog c on c.id = i.card_id
      join others o on o.twitch_id = i.twitch_id
      where not i.shiny and i.qty >= 2
        and not exists (select 1 from mine m where m.card_id = i.card_id and m.total > 0)
    ),
    pairs as (
      select t.twitch_id, d.card_id as give, t.card_id as get, r.rank
      from my_dupes d
      join their_dupes t on t.rarity = d.rarity
      join cards_rarities r on r.code = d.rarity
      where not exists (select 1 from cards_inventory x
                        where x.twitch_id = t.twitch_id and x.card_id = d.card_id and x.qty > 0)
    ),
    ranked as (
      select p.*, row_number() over (partition by p.twitch_id order by p.rank desc, p.get, p.give) as rn,
             count(*) over (partition by p.twitch_id) as cnt,
             max(p.rank) over (partition by p.twitch_id) as best
      from pairs p
    ),
    partners as (
      select k.twitch_id, max(k.cnt) as cnt, max(k.best) as best,
             jsonb_agg(jsonb_build_object('give', cards_card_json(k.give), 'get', cards_card_json(k.get)) order by k.rn) as swaps
      from ranked k where k.rn <= 4 group by k.twitch_id
      order by max(k.best) desc, max(k.cnt) desc limit 12
    )
    select jsonb_agg(jsonb_build_object('partner', o.display_name, 'login', o.login, 'count', p.cnt, 'swaps', p.swaps)
                     order by p.best desc, p.cnt desc, o.display_name)
    from partners p join others o on o.twitch_id = p.twitch_id
  ), '[]');
end $$;

revoke all on function public.cards_web_trade_suggestions() from public, anon;
grant execute on function public.cards_web_trade_suggestions() to authenticated;
