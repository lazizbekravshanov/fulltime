// Confirm the endpoints the page will actually use, from a browser on the real origin.
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
    const text = await res.text();
    try { return { status: res.status, json: JSON.parse(text), bytes: text.length }; }
    catch { return { status: res.status, bytes: text.length, head: text.slice(0, 80) }; }
  } catch (e) { return { error: String(e.message || e) }; }
}, url);

console.log("=== which league is 4480?");
const l = await get(`${API}lookupleague.php?id=4480`);
const league = l.json?.leagues?.[0];
console.log(`  ${league ? league.idLeague + " " + league.strLeague + " (" + league.strSport + ")" : JSON.stringify(l).slice(0, 120)}`);

console.log("\n=== recent results per league (eventspastleague)");
for (const [name, id] of [["EPL", 4328], ["La Liga", 4335], ["UCL", 4480]]) {
  const r = await get(`${API}eventspastleague.php?id=${id}`);
  const evs = r.json?.events ?? [];
  console.log(`  ${name} ${id}: ${r.status ?? r.error} · ${evs.length} event(s) · ${((r.bytes ?? 0) / 1024).toFixed(1)}KB`);
  if (evs[0]) {
    console.log("    keys: " + Object.keys(evs[0]).filter(k => /^(idEvent|str(Home|Away)Team|int(Home|Away)Score|strStatus|dateEvent|strTimestamp|intRound|strSeason)$/.test(k)).join(","));
    for (const e of evs.slice(0, 4))
      console.log(`    ${e.dateEvent} R${e.intRound} ${e.strHomeTeam} ${e.intHomeScore}-${e.intAwayScore} ${e.strAwayTeam} (${e.strStatus})`);
  }
}

console.log("\n=== yesterday by day");
const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
for (const id of [4328, 4335]) {
  const r = await get(`${API}eventsday.php?d=${y}&l=${id}`);
  const evs = r.json?.events ?? [];
  console.log(`  ${id} on ${y}: ${evs.length} event(s)` + (evs[0] ? ` · first ${evs[0].strHomeTeam} ${evs[0].intHomeScore}-${evs[0].intAwayScore} ${evs[0].strAwayTeam}` : ""));
}

console.log("\n=== livescore filtered to our leagues");
const ls = await get(`${API}livescore.php?s=Soccer`);
const live = (ls.json?.livescore ?? []).filter(m => ["4328", "4335", "4480"].includes(String(m.idLeague)));
console.log(`  ${live.length} of ${(ls.json?.livescore ?? []).length} live matches are ours`);
for (const m of live.slice(0, 5))
  console.log(`    [${m.idLeague}] ${m.strHomeTeam} ${m.intHomeScore}-${m.intAwayScore} ${m.strAwayTeam} · ${m.strProgress}' ${m.strStatus}`);

await browser.close();
