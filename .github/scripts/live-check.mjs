// Drives the published site in a real browser and reports what it renders.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
// Playwright is installed outside the repo, so resolve it by path: NODE_PATH does
// not apply to ES module imports.
const { chromium } = createRequire(import.meta.url)(process.env.PW_MODULE ?? "playwright");

const SITE = "https://lazizbekravshanov.github.io/fulltime/";
const SHOTS = "docs";
mkdirSync(SHOTS, { recursive: true });

const snapshot = await (await fetch(SITE + "data.json", { headers: { "cache-control": "no-cache" } })).json();
const pick = () => {
  for (const lg of ["epl", "liga", "ucl"]) {
    const events = snapshot.comps[lg]?.events ?? {};
    const ids = Object.keys(events);
    if (ids.length) return { lg, ev: ids[ids.length - 1], goals: events[ids[ids.length - 1]] };
  }
  return null;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: "dark", timezoneId: "Europe/London" });
const seen = [];
const failures = [];
page.on("response", (r) => {
  const u = r.url();
  if (/espn\.com/.test(u)) seen.push(`${r.status()} ${u.replace(/https:\/\/[^/]+/, "").slice(0, 78)}`);
});
page.on("pageerror", (e) => failures.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/net::|Failed to load resource/.test(m.text())) failures.push("console: " + m.text()); });

console.log("=== snapshot on the server");
console.log("  generated: " + snapshot.generated);
for (const lg of ["epl", "liga", "ucl"]) {
  const c = snapshot.comps[lg];
  console.log(`  ${lg}: matchday ${c.matchday}, leader ${c.rows?.[0]?.short} ${c.rows?.[0]?.pts} pts, `
    + `${Object.keys(c.events ?? {}).length} matches with scorers`);
}

console.log("\n=== the live page, as a browser sees it");
await page.goto(SITE + "#epl", { waitUntil: "load" });
await page.waitForSelector(".trow[data-club]", { timeout: 20000 });
const beforeRefresh = await page.evaluate(() => document.querySelector(".trow .nm").textContent.trim()
  + " " + document.querySelector(".trow .pts").textContent.trim());
await page.waitForTimeout(4000);
const after = await page.evaluate(() => ({
  leader: document.querySelector(".trow .nm").textContent.trim() + " " + document.querySelector(".trow .pts").textContent.trim(),
  pill: document.getElementById("status-txt").textContent.trim(),
  chip: document.querySelector(".chip.acc")?.textContent.trim() ?? "(none)",
  rows: document.querySelectorAll(".trow[data-club]").length,
  crests: [...document.querySelectorAll(".crest img")].filter(i => i.naturalWidth > 0).length,
  crestTotal: document.querySelectorAll(".crest img").length,
  performers: document.querySelectorAll(".perf li").length,
  stats: [...document.querySelectorAll('[data-act="stat"]')].map(b => b.textContent.trim()).join(", ")
}));
console.log("  table first row on first paint: " + beforeRefresh);
console.log("  after the on-load refresh:      " + after.leader);
console.log("  status pill: " + after.pill + "   chip: " + after.chip);
console.log("  rows: " + after.rows + " · crest images loaded: " + after.crests + "/" + after.crestTotal);
console.log("  top performers: " + after.performers + " rows · tabs: " + after.stats);
console.log("  ESPN requests made by the page:");
for (const s of [...new Set(seen)]) console.log("    " + s);
await page.screenshot({ path: `${SHOTS}/screenshot-table.png` });

const match = pick();
if (match) {
  console.log(`\n=== a real match page (${match.lg} ${match.ev}, ${match.goals.length} goal(s) in the snapshot)`);
  await page.goto(`${SITE}#${match.lg}/match/${match.ev}`, { waitUntil: "load" });
  await page.waitForSelector(".mhead", { timeout: 20000 });
  const feed = await page.waitForSelector(".feed .line", { timeout: 20000 }).then(() => true).catch(() => false);
  const m = await page.evaluate(() => ({
    teams: [...document.querySelectorAll(".team .nm")].map(e => e.textContent.trim()).join(" v "),
    score: document.querySelector(".bigscore")?.textContent.trim(),
    goals: [...document.querySelectorAll(".sheet .goal")].map(e => e.textContent.replace(/\s+/g, " ").trim()),
    lines: document.querySelectorAll(".feed .line").length,
    first: document.querySelector(".feed .line span:last-child")?.textContent.trim().slice(0, 120) ?? null
  }));
  console.log("  " + m.teams + "   " + m.score);
  console.log("  scorers: " + (m.goals.join(" · ") || "(none)"));
  console.log("  commentary lines from ESPN: " + m.lines + (feed ? "" : "  (none arrived)"));
  if (m.first) console.log("  latest line: " + m.first);
  await page.screenshot({ path: `${SHOTS}/screenshot-match.png` });
}

const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: "dark", timezoneId: "Europe/London" });
await phone.goto(SITE + "#liga", { waitUntil: "load" });
await phone.waitForSelector(".trow[data-club]", { timeout: 20000 });
await phone.waitForTimeout(3500);
const over = await phone.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
console.log("\n=== phone at 390px: horizontal overflow " + over + "px");
await phone.screenshot({ path: `${SHOTS}/screenshot-phone.png` });

await browser.close();
console.log("\n=== " + (failures.length ? failures.length + " page error(s)" : "no page errors"));
for (const f of failures) console.log("  " + f);
process.exit(failures.length ? 1 : 0);
