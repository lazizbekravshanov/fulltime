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
const SNAPSHOT = join(HERE, "..", "data.json");
const SITE = "https://site.api.espn.com/apis";
const MAX_COMMENTARY_MATCHES = 6;
const MAX_LINES = 160;

const stamp = (offsetDays) => {
  const d = new Date(Date.now() + offsetDays * 864e5);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
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
      out.rows = parsed.rows.map((r) => ({
        ...r, short: byId.get(String(r.id)) ?? (rename ? rename(r.team) : r.short)
      }));
      out.matchday = parsed.matchday;
    }
  } catch (e) {
    console.error(`[live] ${key} standings: ${e.message}`);
  }

  // Yesterday through tomorrow covers everything in play or just finished.
  let events = [];
  try {
    const feed = await getJSON(
      `${SITE}/site/v2/sports/soccer/${cfg.espn}/scoreboard?dates=${stamp(-1)}-${stamp(1)}&limit=100`);
    events = feed.events ?? [];
  } catch (e) {
    console.error(`[live] ${key} scoreboard: ${e.message}`);
  }

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
for (const [key, cfg] of Object.entries(COMPS)) comps[key] = await league(key, cfg);
writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), comps }) + "\n");
console.error(`wrote ${OUT}`);
