// What exactly does TheSportsDB return, read from a browser on the real origin?
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PW_MODULE ?? "playwright");

const SITE = "https://lazizbekravshanov.github.io/fulltime/";
const API = "https://www.thesportsdb.com/api/v1/json/3/";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(SITE, { waitUntil: "domcontentloaded" });

const get = (url) => page.evaluate(async (u) => {
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(15000) });
    return { status: res.status, json: await res.json() };
  } catch (e) { return { error: String(e.message || e) }; }
}, url);

console.log("=== league ids");
for (const country of ["England", "Spain"]) {
  const r = await get(`${API}search_all_leagues.php?c=${country}&s=Soccer`);
  for (const l of (r.json?.countries ?? []).slice(0, 6))
    console.log(`  ${country}: ${l.idLeague} ${l.strLeague}`);
}
const ucl = await get(`${API}all_leagues.php`);
for (const l of (ucl.json?.leagues ?? []).filter(l => /champions league/i.test(l.strLeague || "")).slice(0, 4))
  console.log(`  europe: ${l.idLeague} ${l.strLeague} (${l.strSport})`);

console.log("\n=== tables");
for (const [name, id] of [["EPL", 4328], ["La Liga", 4335], ["UCL", 4480]]) {
  for (const season of ["2026-2027", "2026-27"]) {
    const r = await get(`${API}lookuptable.php?l=${id}&s=${season}`);
    const rows = r.json?.table ?? [];
    console.log(`  ${name} ${id} ${season}: ${r.status ?? r.error} · ${rows.length} rows`);
    if (rows.length) {
      console.log("    keys: " + Object.keys(rows[0]).join(","));
      console.log("    top:  " + rows.slice(0, 3).map(t => `${t.intRank} ${t.strTeam} ${t.intPoints}pts P${t.intPlayed}`).join(" | "));
      break;
    }
  }
}

console.log("\n=== livescore");
const ls = await get(`${API}livescore.php?s=Soccer`);
const live = ls.json?.livescore ?? [];
console.log(`  ${live.length} live soccer matches`);
const leagues = {};
for (const m of live) leagues[m.strLeague] = (leagues[m.strLeague] ?? 0) + 1;
console.log("  leagues: " + Object.entries(leagues).slice(0, 12).map(([k, v]) => `${k}(${v})`).join(", "));
if (live[0]) {
  console.log("  keys: " + Object.keys(live[0]).join(","));
  const m = live[0];
  console.log(`  sample: [${m.idLeague}] ${m.strHomeTeam} ${m.intHomeScore}-${m.intAwayScore} ${m.strAwayTeam} · ${m.strProgress} · ${m.strStatus}`);
}

console.log("\n=== today's matches");
const day = new Date().toISOString().slice(0, 10);
for (const id of [4328, 4335, 4480]) {
  const r = await get(`${API}eventsday.php?d=${day}&l=${id}`);
  const evs = r.json?.events ?? [];
  console.log(`  league ${id}: ${evs.length} event(s)` + (evs[0]
    ? ` · keys: ${Object.keys(evs[0]).slice(0, 14).join(",")}` : ""));
  for (const e of evs.slice(0, 3))
    console.log(`    ${e.strHomeTeam} ${e.intHomeScore ?? "-"}-${e.intAwayScore ?? "-"} ${e.strAwayTeam} · ${e.strStatus} · ${e.strTime}`);
}

await browser.close();
