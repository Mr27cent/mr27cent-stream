-- Herden-Karten: Der Kanal Mr27cent sammelt wie alle anderen Zuschauer mit
-- (Zuschauzeit, Gazellen-Bonus, Zuschau- und Gratis-Packs). Bots bleiben ausgenommen.
-- Zusätzlich filtert cards-tick den Kanal nicht mehr aus der Chatter-Liste.
delete from public.cards_ignored where login = 'mr27cent';
