// Why did the scoreboard stop? This runs on a GitHub runner, which can reach ESPN,
// and writes its findings to a committed file, because Actions logs are not
// readable from everywhere this repo gets worked on.
//
// It asks three questions:
//   1. Is the scoreboard route we call still alive, and does any parameter shape
//      bring events back?
//   2. Are the routes we know still work (standings, core-API leaders) really fine,
//      so the fault is narrowed to the scoreboard?
//   3. Does the core API — which demonstrably still answers, since the leader
//      boards it feeds are still populated — expose the season's events as a
//      replacement source?
import { writeFileSync, mkdirSync } from "node:fs";

const SITE = "https://site.api.espn.com/apis";
const CORE = "https://sports.core.api.espn.com/v2/sports/soccer/leagues";
const YEAR = Number(process.env.SEASON_YEAR) || new Date().getUTCFullYear();
const SLUGS = ["eng.1", "esp.1", "uefa.champions"];

async function probe(label, url, pick) {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { "user-agent": "league-tables-updater" },
      signal: AbortSignal.timeout(25000) });
    const text = await res.text();
    const row = { label, url, status: res.status, ms: Date.now() - started, bytes: text.length };
    row.contentType = res.headers.get("content-type");
    if (!res.ok) { row.body = text.slice(0, 300); return row; }
    let json;
    try { json = JSON.parse(text); } catch { row.parse = "not JSON"; row.body = text.slice(0, 200); return row; }
    Object.assign(row, pick ? pick(json) : {});
    return row;
  } catch (e) {
    return { label, url, error: String(e.message || e), ms: Date.now() - started };
  }
}

// What a scoreboard answer should contain, and what it gives us instead.
const scoreboard = (j) => {
  const events = j.events ?? [];
  const league = (j.leagues ?? [])[0];
  const out = { topKeys: Object.keys(j).slice(0, 12), events: events.length };
  if (league) {
    out.leagueName = league.name ?? league.abbreviation ?? null;
    out.season = league.season ? { year: league.season.year, type: league.season.type?.type ?? null,
      start: league.season.startDate?.slice(0, 10), end: league.season.endDate?.slice(0, 10) } : null;
    // The calendar is ESPN telling us which dates it will answer for.
    const cal = league.calendar;
    if (Array.isArray(cal) && cal.length)
      out.calendar = { n: cal.length, first: String(cal[0]).slice(0, 10), last: String(cal[cal.length - 1]).slice(0, 10) };
  }
  if (events[0]) {
    const g = events[0].competitions?.[0];
    out.sample = { id: events[0].id, date: String(g?.date ?? events[0].date ?? "").slice(0, 16),
      completed: g?.status?.type?.completed ?? null,
      teams: (g?.competitors ?? []).map(c => c.team?.displayName).join(" v ") };
  }
  return out;
};

const report = { generatedAt: new Date().toISOString(), seasonYear: YEAR, runner: process.env.GITHUB_RUN_ID ?? null, rows: [] };
const add = async (...a) => { const r = await probe(...a); report.rows.push(r); 
  console.log(`${String(r.status ?? r.error).padEnd(22)} ${String(r.events ?? "").padStart(4)} ev  ${r.label}`); return r; };

console.log("=== 1. the exact call that stopped working, and parameter variants");
for (const slug of SLUGS) {
  const m = `${YEAR}08`;
  await add(`${slug} scoreboard: as the job calls it`,
    `${SITE}/site/v2/sports/soccer/${slug}/scoreboard?dates=${m}01-${m}31&limit=500`, scoreboard);
  await add(`${slug} scoreboard: no parameters at all`,
    `${SITE}/site/v2/sports/soccer/${slug}/scoreboard`, scoreboard);
  await add(`${slug} scoreboard: date range, no limit`,
    `${SITE}/site/v2/sports/soccer/${slug}/scoreboard?dates=${m}01-${m}31`, scoreboard);
  await add(`${slug} scoreboard: date range, limit=100`,
    `${SITE}/site/v2/sports/soccer/${slug}/scoreboard?dates=${m}01-${m}31&limit=100`, scoreboard);
  await add(`${slug} scoreboard: a single day`,
    `${SITE}/site/v2/sports/soccer/${slug}/scoreboard?dates=${m}22`, scoreboard);
  await add(`${slug} scoreboard: season + seasontype`,
    `${SITE}/site/v2/sports/soccer/${slug}/scoreboard?season=${YEAR}&seasontype=1&limit=500`, scoreboard);
  await add(`${slug} scoreboard: the other path prefix`,
    `${SITE}/v2/sports/soccer/${slug}/scoreboard?dates=${m}01-${m}31&limit=500`, scoreboard);
}

console.log("\n=== 2. controls: the routes we believe still work");
for (const slug of SLUGS) {
  await add(`${slug} standings (the job's control)`,
    `${SITE}/v2/sports/soccer/${slug}/standings?season=${YEAR}`,
    (j) => ({ children: (j.children ?? []).length, entries: (j.children?.[0]?.standings?.entries ?? j.standings?.entries ?? []).length }));
  await add(`${slug} core-API leaders (feeds the leader boards, still populated)`,
    `${CORE}/${slug}/seasons/${YEAR}/types/1/leaders`,
    (j) => ({ categories: (j.categories ?? []).length }));
}

console.log("\n=== 3. the candidate replacement: the core API's own event list");
for (const slug of SLUGS) {
  const r = await add(`${slug} core-API season events (page 1)`,
    `${CORE}/${slug}/seasons/${YEAR}/events?limit=1000`,
    (j) => ({ count: j.count, pageCount: j.pageCount, pageSize: j.pageSize, items: (j.items ?? []).length,
      firstRef: (j.items ?? [])[0]?.$ref ?? null }));
  // If it answers, follow one $ref so we know the per-event shape we would have to parse.
  if (r.firstRef) {
    await add(`${slug} core-API one event, resolved`, r.firstRef.replace(/^http:/, "https:"),
      (j) => ({ id: j.id, date: String(j.date ?? "").slice(0, 16), name: j.name,
        competitionsRef: j.competitions?.[0]?.$ref ? "yes" : "no",
        topKeys: Object.keys(j).slice(0, 14) }));
  }
  for (const type of [1, 2, 3]) {
    await add(`${slug} core-API events, season type ${type}`,
      `${CORE}/${slug}/seasons/${YEAR}/types/${type}/events?limit=1000`,
      (j) => ({ count: j.count, pageCount: j.pageCount, items: (j.items ?? []).length }));
  }
}

console.log("\n=== 4. is the season year itself the problem?");
for (const y of [YEAR - 1, YEAR, YEAR + 1]) {
  await add(`eng.1 scoreboard for season ${y}`,
    `${SITE}/site/v2/sports/soccer/eng.1/scoreboard?dates=${y}09&limit=500`, scoreboard);
}

mkdirSync(".github/probe", { recursive: true });
writeFileSync(".github/probe/espn.json", JSON.stringify(report, null, 1) + "\n");

const alive = report.rows.filter(r => (r.events ?? 0) > 0 || (r.items ?? 0) > 0 || (r.count ?? 0) > 0);
console.log(`\n=== ${report.rows.length} probes, ${alive.length} returned data`);
for (const r of alive) console.log(`  ${r.label}  →  ${r.events ?? r.items ?? r.count}`);
console.log("wrote .github/probe/espn.json");
