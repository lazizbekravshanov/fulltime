// Which sources can the published page actually read? The only trustworthy test
// is a real browser fetch from the real origin: curl with an Origin header lies,
// as ESPN proved.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PW_MODULE ?? "playwright");

const SITE = "https://lazizbekravshanov.github.io/fulltime/";
const ESPN_STANDINGS = "https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings?season=2026";
const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20260913";

const candidates = [
  ["ESPN direct (control, expected to fail)", ESPN_STANDINGS],
  ["raw.githubusercontent (control, expected to pass)",
   "https://raw.githubusercontent.com/lazizbekravshanov/fulltime/main/live.json"],
  ["allorigins /raw", "https://api.allorigins.win/raw?url=" + encodeURIComponent(ESPN_STANDINGS)],
  ["corsproxy.io", "https://corsproxy.io/?url=" + encodeURIComponent(ESPN_STANDINGS)],
  ["codetabs proxy", "https://api.codetabs.com/v1/proxy/?quest=" + encodeURIComponent(ESPN_STANDINGS)],
  ["thesportsdb table", "https://www.thesportsdb.com/api/v1/json/3/lookuptable.php?l=4328&s=2026-2027"],
  ["thesportsdb livescore", "https://www.thesportsdb.com/api/v1/json/3/livescore.php?s=Soccer"],
  ["football-data.org (no key)", "https://api.football-data.org/v4/competitions/PL/standings"],
  ["ESPN scoreboard via allorigins", "https://api.allorigins.win/raw?url=" + encodeURIComponent(ESPN_SCOREBOARD)]
];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(SITE, { waitUntil: "domcontentloaded" });

for (const [name, url] of candidates) {
  const result = await page.evaluate(async ([name, url]) => {
    const started = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const text = await res.text();
      let shape = "not json";
      try {
        const j = JSON.parse(text);
        shape = Array.isArray(j) ? `array(${j.length})` : "keys: " + Object.keys(j).slice(0, 6).join(",");
      } catch { /* leave as text */ }
      return { ok: true, status: res.status, ms: Date.now() - started, bytes: text.length, shape,
               head: text.slice(0, 90).replace(/\s+/g, " ") };
    } catch (e) {
      return { ok: false, ms: Date.now() - started, error: String(e.message || e).slice(0, 110) };
    }
  }, [name, url]);
  console.log(`\n=== ${name}`);
  console.log(result.ok
    ? `  ${result.status} · ${result.ms}ms · ${(result.bytes / 1024).toFixed(1)}KB · ${result.shape}\n  ${result.head}`
    : `  BLOCKED after ${result.ms}ms · ${result.error}`);
}

await browser.close();
