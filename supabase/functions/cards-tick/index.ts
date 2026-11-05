// Supabase Edge Function: cards-tick
// Läuft jede Minute (eigener Cron, unabhängig vom Idle-Spiel):
// - alle 5 Minuten Zuschauzeit für die Herden-Karten an alle im Chat (nur live)
// - Kanalpunkte-Belohnung „Karten-Pack“: Einlösungen öffnen und erfüllen,
//   bei Ablehnung (Limit, noch nicht gestartet) erstatten
// - schaltet die Belohnung zum Start (cards_config.launch_at) automatisch frei
// - lässt abgelaufene Tauschangebote verfallen
// - holt die Twitch-Profilbilder für Personen-Karten (täglich aufgefrischt)
// Den Twitch-Zugang erneuert nur twitch-tick – hier wird er nur gelesen.
//
// Verwaltung (Header x-cron-secret, ?action=…):
//   status          Belohnung + Einstellungen ansehen
//   reward_create   Belohnung anlegen (ausgeschaltet, für Tests)
//   reward_enable   Belohnung einschalten
//   reward_disable  Belohnung ausschalten
import { createClient } from "npm:@supabase/supabase-js@2";

const CLIENT_ID = Deno.env.get("TWITCH_CLIENT_ID") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";

function serviceKey(): string {
  const own = Deno.env.get("DB_SECRET_KEY");
  if (own) return own;
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const o = JSON.parse(raw);
      const v = o.default ?? Object.values(o)[0];
      if (typeof v === "string") return v;
    } catch (_e) {
      if (raw.startsWith("sb_secret_")) return raw;
    }
  }
  return "";
}

// deno-lint-ignore no-explicit-any
let sb: any;

type Tw = { id: string; token: string };

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// Twitch-Zugang nur lesen. Läuft er gleich ab, warten wir eine Minute auf twitch-tick.
async function getToken(): Promise<Tw | null> {
  const { data: row } = await sb.from("twitch_tokens")
    .select("user_id,access_token,expires_at").eq("id", 1).maybeSingle();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() - Date.now() < 60 * 1000) return null;
  return { id: row.user_id, token: row.access_token };
}

async function tw(t: Tw, path: string, init: RequestInit = {}) {
  const r = await fetch(`https://api.twitch.tv/helix/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${t.token}`,
      "Client-Id": CLIENT_ID,
      "Content-Type": "application/json",
    },
  });
  const text = await r.text();
  const j = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(`Twitch ${path.split("?")[0]}: ${j.message ?? r.status}`);
  return j;
}

type Chatter = { id: string; login: string; name: string };

async function chatters(t: Tw): Promise<Chatter[]> {
  const out: Chatter[] = [];
  let cursor = "";
  for (let i = 0; i < 10; i++) {
    const cj = await tw(
      t,
      `chat/chatters?broadcaster_id=${t.id}&moderator_id=${t.id}&first=1000` +
        (cursor ? `&after=${cursor}` : ""),
    );
    for (const c of cj.data ?? []) {
      out.push({ id: String(c.user_id), login: String(c.user_login), name: String(c.user_name) });
    }
    cursor = cj.pagination?.cursor ?? "";
    if (!cursor) break;
  }
  return out;
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

// deno-lint-ignore no-explicit-any
async function config(): Promise<any> {
  const { data, error } = await sb.from("cards_config").select("*").eq("id", 1).single();
  if (error) throw new Error("cards_config: " + error.message);
  return data;
}

async function saveConfig(fields: Record<string, unknown>) {
  const { error } = await sb.from("cards_config")
    .update({ ...fields, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) throw new Error("cards_config speichern: " + error.message);
}

// ── Belohnung ────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function createReward(t: Tw, cfg: any, enabled: boolean) {
  if (!cfg.points_price) throw new Error("Preis fehlt (cards_config.points_price)");
  const j = await tw(t, `channel_points/custom_rewards?broadcaster_id=${t.id}`, {
    method: "POST",
    body: JSON.stringify({
      title: cfg.reward_title,
      prompt: cfg.reward_prompt,
      cost: cfg.points_price,
      background_color: cfg.reward_color,
      is_enabled: enabled,
      is_max_per_user_per_stream_enabled: true,
      max_per_user_per_stream: cfg.points_packs_per_stream,
    }),
  });
  const id = String(j.data?.[0]?.id ?? "");
  if (!id) throw new Error("Twitch hat keine Belohnungs-ID geliefert");
  await saveConfig({ reward_id: id });
  return j.data[0];
}

async function setRewardEnabled(t: Tw, rewardId: string, enabled: boolean) {
  const j = await tw(t, `channel_points/custom_rewards?broadcaster_id=${t.id}&id=${rewardId}`, {
    method: "PATCH",
    body: JSON.stringify({ is_enabled: enabled }),
  });
  return j.data?.[0];
}

async function getReward(t: Tw, rewardId: string) {
  const j = await tw(t, `channel_points/custom_rewards?broadcaster_id=${t.id}&id=${rewardId}&only_manageable_rewards=true`);
  return j.data?.[0] ?? null;
}

// ── Ein Durchlauf ────────────────────────────────────────────────────────────

async function run(t: Tw) {
  const out: Record<string, unknown> = {};
  const cfg = await config();
  const launched = Date.now() >= new Date(cfg.launch_at).getTime();

  // 1) Live? (Stream-ID trennt das Limit „3 pro Stream“)
  const sj = await tw(t, `streams?user_id=${t.id}`);
  const stream = Array.isArray(sj.data) && sj.data.length > 0 ? sj.data[0] : null;
  out.live = !!stream;

  // 2) Zuschauzeit alle tick_minutes (vor dem Start zählen in der Datenbank nur Tester)
  const step = cfg.tick_minutes * 60 * 1000;
  const last = cfg.last_watch_tick ? new Date(cfg.last_watch_tick).getTime() : 0;
  if (!stream) {
    if (last) await saveConfig({ last_watch_tick: null });
  } else if (!last) {
    // Gerade live gegangen: erst nach einem vollen Abschnitt zählen
    await saveConfig({ last_watch_tick: new Date().toISOString() });
  } else if (Date.now() - last >= step - 20000) {
    // Der Kanal selbst sammelt mit wie alle anderen; Bots filtert cards_ignored in der Datenbank
    const viewers = await chatters(t);
    out.gezaehlt = await rpc("cards_add_watch", {
      p_viewers: viewers, p_minutes: cfg.tick_minutes, p_stream_id: String(stream.id),
    });
    out.chatter = viewers.length;
    const keepRhythm = Date.now() - last < 2 * step;
    await saveConfig({ last_watch_tick: new Date(keepRhythm ? last + step : Date.now()).toISOString() });
  }

  // 3) Zum Start die Belohnung einmalig freischalten (bzw. anlegen, falls es sie noch
  //    nicht gibt). Danach bleibt sie, wie du sie bei Twitch einstellst.
  let rewardId: string | null = cfg.reward_id;
  if (launched && !cfg.reward_launch_done) {
    if (!rewardId && cfg.points_price) {
      rewardId = (await createReward(t, cfg, true)).id;
      out.belohnung = "angelegt";
    } else if (rewardId) {
      await setRewardEnabled(t, rewardId, true);
      out.belohnung = "freigeschaltet";
    }
    if (rewardId) await saveConfig({ reward_launch_done: true });
    else out.warnung = "Start erreicht, aber kein Preis gesetzt (cards_config.points_price)";
  }

  // 4) Eingelöste Packs abarbeiten
  if (rewardId) {
    const rj = await tw(
      t,
      `channel_points/custom_rewards/redemptions?broadcaster_id=${t.id}` +
        `&reward_id=${rewardId}&status=UNFULFILLED&first=50`,
    );
    const streamKey = stream ? String(stream.id)
      : "offline-" + new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
    let opened = 0, refunded = 0;
    for (const rd of rj.data ?? []) {
      let res;
      try {
        res = await rpc("cards_points_pack", {
          p_id: String(rd.user_id),
          p_login: String(rd.user_login),
          p_name: String(rd.user_name),
          p_redemption_id: String(rd.id),
          p_stream_id: streamKey,
        });
      } catch (e) {
        // Datenbank-Fehler: Einlösung offen lassen, nächste Minute neu versuchen
        console.error("cards_points_pack:", e instanceof Error ? e.message : e);
        continue;
      }
      const status = res?.ok ? "FULFILLED" : "CANCELED"; // CANCELED = Punkte zurück
      await tw(
        t,
        `channel_points/custom_rewards/redemptions?id=${rd.id}&broadcaster_id=${t.id}&reward_id=${rewardId}`,
        { method: "PATCH", body: JSON.stringify({ status }) },
      );
      if (res?.ok) opened++;
      else refunded++;
    }
    if (opened) out.packs_geoeffnet = opened;
    if (refunded) out.erstattet = refunded;
  }

  // 5) Abgelaufene Tauschangebote
  const expired = await rpc("cards_expire_trades", {});
  if (expired) out.tausch_abgelaufen = expired;

  // 6) Profilbilder der Personen-Karten holen bzw. täglich auffrischen
  try {
    const todo: { id: string; login: string }[] = (await rpc("cards_avatar_todo", {})) ?? [];
    if (todo.length) {
      const logins = [...new Set(todo.map((r) => r.login))];
      const uj = await tw(t, "users?" + logins.map((l) => "login=" + encodeURIComponent(l)).join("&"));
      // deno-lint-ignore no-explicit-any
      const found = new Map<string, any>((uj.data ?? []).map((u: any) => [String(u.login).toLowerCase(), u]));
      // Nicht gefundene Namen trotzdem melden, damit sie erst morgen wieder versucht werden
      const rows = logins.map((l) => {
        const u = found.get(l);
        return { login: l, twitch_id: u ? String(u.id) : null, avatar: u ? String(u.profile_image_url) : null };
      });
      out.profilbilder = await rpc("cards_avatar_save", { p_rows: rows });
      const missing = logins.filter((l) => !found.has(l));
      if (missing.length) out.profilbild_fehlt = missing;
    }
  } catch (e) {
    console.error("Profilbilder:", e instanceof Error ? e.message : e);
  }

  return out;
}

// ── Verwaltung ───────────────────────────────────────────────────────────────

async function admin(t: Tw, action: string) {
  const cfg = await config();
  if (action === "status") {
    return {
      start: cfg.launch_at,
      preis: cfg.points_price,
      limit_pro_stream: cfg.points_packs_per_stream,
      belohnung: cfg.reward_id ? await getReward(t, cfg.reward_id) : null,
    };
  }
  if (action === "reward_create") {
    if (cfg.reward_id) return { fehler: "Belohnung gibt es schon", id: cfg.reward_id };
    const rw = await createReward(t, cfg, false);
    return { angelegt: rw.id, eingeschaltet: rw.is_enabled };
  }
  if (action === "reward_enable" || action === "reward_disable") {
    if (!cfg.reward_id) return { fehler: "Noch keine Belohnung angelegt" };
    const rw = await setRewardEnabled(t, cfg.reward_id, action === "reward_enable");
    return { id: cfg.reward_id, eingeschaltet: rw?.is_enabled };
  }
  return { fehler: "Unbekannte Aktion" };
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json({ fehler: "Nicht erlaubt" }, 401);
  }
  const key = serviceKey();
  if (!CLIENT_ID || !key) return json({ fehler: "Es fehlen Secrets (Client ID oder Server-Schlüssel)." }, 500);
  sb = createClient(SB_URL, key);

  try {
    const t = await getToken();
    if (!t) return json({ warte: "Twitch-Zugang fehlt oder wird gerade von twitch-tick erneuert" });
    const action = new URL(req.url).searchParams.get("action");
    return json(action ? await admin(t, action) : await run(t));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("cards-tick Fehler:", msg);
    return json({ fehler: msg }, 500);
  }
});
