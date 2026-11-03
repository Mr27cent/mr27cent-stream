-- ═══════════════════════════════════════════════════════════════════════════
--  Herden-Karten · Phase 5: OBS-Overlay (karten-overlay.html)
--  Das Overlay fragt alle paar Sekunden neue Einträge aus cards_overlay_queue ab
--  (Legendary, Mythic, Shiny). Wer sein Album versteckt, erscheint anonym.
--  Außerdem enthält cards_card_json jetzt das Kartenbild (für Pack-Öffnung & Overlay).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.cards_card_json(p_card text, p_shiny boolean default false) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', c.id, 'number', c.number, 'name', c.name, 'image', c.image,
                            'rarity', c.rarity, 'rarity_name', r.name, 'shiny', p_shiny)
  from cards_catalog c join cards_rarities r on r.code = c.rarity where c.id = p_card
$$;

-- p_after = letzte gesehene ID; ohne p_after nur die aktuelle letzte ID (nichts Altes nachholen).
-- Liefert höchstens 10 Einträge der letzten 10 Minuten.
create function public.cards_overlay_feed(p_after bigint default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
      'card', cards_card_json(q.card_id, q.shiny)) as e
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

revoke all on function public.cards_card_json(text, boolean) from public, anon, authenticated;
revoke all on function public.cards_overlay_feed(bigint) from public;
grant execute on function public.cards_overlay_feed(bigint) to anon, authenticated;
