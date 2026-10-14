// Writes live.json: the small, fast-moving half of the data.
//
// Browsers cannot read ESPN directly — it sends no Access-Control-Allow-Origin to
// a real fetch, whatever it tells curl — so everything time-sensitive is pulled
// here instead and committed every few minutes. This job touches one standings
// feed and one scoreboard per competition, plus a commentary feed for the handful
// of matches in play, so it stays quick enough to run often.

import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPS, startYear, getJSON, parseESPN, scorersFrom, renamer } from "./update-standings.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "live.json");
// Commentary is bulky and only wanted when a match is opened, so it lives apart
// from the file the page polls.
const OUT_COMMENTARY = join(HERE, "..", "commentary.json");
const SNAPSHOT = join(HERE, "..", "data.json");
const SITE = "https://site.api.espn.com/apis";
const MAX_COMMENTARY_MATCHES = 6;
const MAX_LINES = 160;

const stamp = (offsetDays) => {
  const d = new Date(Date.now() + offsetDays * 864e5);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
};

// ESPN stopped accepting a YYYYMMDD-YYYYMMDD range on 2026-09-16 — it answers
// {"code":400,"message":"Failed to get events endpoint."} — and this job caught
// the error and carried on, so live.json has carried no matches at all since.
// A bare YYYYMM is still accepted, so ask for the month (or the two months the
// window straddles) and narrow to the days we want ourselves.
const monthsAround = () => [...new Set([stamp(-1).slice(0, 6), stamp(0).slice(0, 6), stamp(1).slice(0, 6)])];
const inWindow = (iso) => {
  const day = String(iso ?? "").slice(0, 10).replace(/-/g, "");
  return day >= stamp(-1) && day <= stamp(1);
};

let snapshot = null;
try {
  snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
} catch {
  console.error("[live] no snapshot to align club names against");
}

async function league(key, cfg) {
  const out = { matches: {} };

  // The table, so standings move with results rather than waiting for the hourly job.
  try {
    const json = await getJSON(`${SITE}/v2/sports/soccer/${cfg.espn}/standings?season=${startYear}`);
    const parsed = parseESPN(json);
    if (parsed?.rows?.length) {
      // Keep the snapshot's short names: every fixture is keyed by them.
      const known = snapshot?.comps?.[key]?.rows ?? [];
      const rename = known.length ? renamer(known) : null;
      const byId = new Map(known.filter((r) => r.id != null).map((r) => [String(r.id), r.short]));
      // This file is polled, so it carries only what cannot be worked out from
      // what it already says: the logo URL is the id, and gd is gf minus ga.
      out.rows = parsed.rows.map(({ logo, gd, ...r }) => ({
        ...r, short: byId.get(String(r.id)) ?? (rename ? rename(r.team) : r.short)
      }));
      out.matchday = parsed.matchday;
    }
  } catch (e) {
    console.error(`[live] ${key} standings: ${e.message}`);
  }

  // Yesterday through tomorrow covers everything in play or just finished.
  let events = [];
  for (const month of monthsAround()) {
    try {
      const feed = await getJSON(
        `${SITE}/site/v2/sports/soccer/${cfg.espn}/scoreboard?dates=${month}&limit=500`);
      events.push(...(feed.events ?? []));
    } catch (e) {
      console.error(`[live] ${key} scoreboard ${month}: ${e.message}`);
    }
  }
  const before = events.length;
  events = events.filter((e) => inWindow(e.competitions?.[0]?.date ?? e.date));
  console.error(`[live] ${key}: ${before} event(s) this month, ${events.length} in the window`);

  const wanted = [];
  for (const event of events) {
    const game = event.competitions?.[0];
    const home = (game?.competitors ?? []).find((c) => c.homeAway === "home");
    const away = (game?.competitors ?? []).find((c) => c.homeAway === "away");
    const id = String(event.id ?? "");
    if (!id || !home?.team || !away?.team) continue;
    const num = (v) => { const n = Number(v?.value ?? v?.displayValue ?? v); return Number.isFinite(n) ? n : null; };
    const hg = num(home.score);
    const ag = num(away.score);
    const state = game.status?.type?.state ?? "pre";       // pre | in | post
    const entry = { state, hg, ag };
    if (state === "in") entry.clock = game.status?.displayClock ?? null;
    const scorers = scorersFrom(game, home.team?.id, state === "post" ? hg : null, state === "post" ? ag : null);
    if (scorers.length) entry.goals = scorers;
    out.matches[id] = entry;
    if (state === "in" || (state === "post" && game.status?.type?.completed)) wanted.push({ id, state });
  }

  // Commentary for the matches someone might actually be watching.
  const picks = [...wanted.filter((w) => w.state === "in"), ...wanted.filter((w) => w.state !== "in")]
    .slice(0, MAX_COMMENTARY_MATCHES);
  for (const { id } of picks) {
    try {
      const summary = await getJSON(`${SITE}/site/v2/sports/soccer/${cfg.espn}/summary?event=${id}`);
      const lines = (summary.commentary ?? [])
        .map((c) => [String(c?.time?.displayValue ?? "").replace(/'/g, "").trim(), String(c?.text ?? "").trim()])
        .filter(([, text]) => text)
        .slice(-MAX_LINES);
      if (lines.length) (out.commentary ??= {})[id] = lines;
    } catch (e) {
      console.error(`[live] ${key} commentary ${id}: ${e.message}`);
    }
  }

  const inPlay = Object.values(out.matches).filter((m) => m.state === "in").length;
  console.error(`[live] ${key}: ${out.rows ? out.rows.length + " rows" : "no table"}`
    + `, ${Object.keys(out.matches).length} match(es) in window, ${inPlay} in play`
    + `, commentary for ${Object.keys(out.commentary ?? {}).length}`);
  return out;
}

const comps = {};
const commentary = {};
for (const [key, cfg] of Object.entries(COMPS)) {
  const built = await league(key, cfg);
  if (built.commentary) {
    commentary[key] = built.commentary;
    delete built.commentary;
  }
  comps[key] = built;
}
const generated = new Date().toISOString();
writeFileSync(OUT, JSON.stringify({ generated, comps }) + "\n");
writeFileSync(OUT_COMMENTARY, JSON.stringify({ generated, comps: commentary }) + "\n");
const kb = (f) => (readFileSync(f, "utf8").length / 1024).toFixed(1) + "KB";
console.error(`wrote ${OUT} (${kb(OUT)}) and ${OUT_COMMENTARY} (${kb(OUT_COMMENTARY)})`);
