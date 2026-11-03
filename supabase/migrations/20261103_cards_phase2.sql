-- ═══════════════════════════════════════════════════════════════════════════
--  Herden-Karten · Phase 2: Kanalpunkte-Belohnung + Zuschauzeit-Takt
--  Gebraucht von der Edge Function cards-tick (eigener Cron, unabhängig vom
--  Idle-Spiel). Die Belohnung wird erst zum Start (launch_at) freigeschaltet.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.cards_config
  add column reward_id text,                                   -- von cards-tick angelegt
  add column reward_title text not null default 'Herden-Karten-Pack',
  add column reward_prompt text not null default
    'Öffnet ein Pack mit 5 Herden-Karten (1 davon Rare oder besser). Max. 3 pro Stream. Dein Album: mr27cent.pages.dev/#karten',
  add column reward_color text not null default '#C8A24A',
  add column last_watch_tick timestamptz,                      -- Rhythmus der 5-Minuten-Ticks
  add column tick_minutes int not null default 5;

-- Zum Start wird die Belohnung genau einmal eingeschaltet
alter table public.cards_config add column reward_launch_done boolean not null default false;
