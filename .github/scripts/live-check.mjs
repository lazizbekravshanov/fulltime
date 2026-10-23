// Drives the published site in a real browser and reports what it renders.
//
// The report also goes to a committed file. Actions logs are not readable from
// every environment this repo gets worked on, and a run that says only "exit
// code 1" tells you nothing about which page threw what.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
// Playwright is installed outside the repo, so resolve it by path: NODE_PATH does
// not apply to ES module imports.
const { chromium } = createRequire(import.meta.url)(process.env.PW_MODULE ?? "playwright");

// Overridable so this script can be run against a local copy. CI leaves it unset.
const SITE = process.env.SITE ?? "https://lazizbekravshanov.github.io/fulltime/";
const SHOTS = "docs";
mkdirSync(SHOTS, { recursive: true });

const seen = [];
const failures = [];
const report = { checkedAt: new Date().toISOString(), run: process.env.GITHUB_RUN_ID ?? null,
  deployment: null, files: {}, page: {}, perCompetition: {}, match: null, phone: {}, sources: [], failures };

// However this run ends — including on a throw nothing here anticipated — the
// report is the only thing that explains it afterwards, so always write it.
let flushed = false;
const flush = () => {
  if (flushed) return;
  flushed = true;
  report.sources = [...new Set(seen)];
  mkdirSync(".github/probe", { recursive: true });
  writeFileSync(".github/probe/live-check.json", JSON.stringify(report, null, 1) + "\n");
  console.log("wrote .github/probe/live-check.json");
};
process.on("exit", flush);
for (const sig of ["uncaughtException", "unhandledRejection"]) process.on(sig, (e) => {
  failures.push(`${sig}: ${e && e.message ? String(e.message).split("\n")[0] : e}`);
  flush();
  process.exit(1);
});

/* Pages takes a minute or so to publish, and this job is usually started by the
   same push that triggers the build. Judging whatever happens to be deployed at
   that moment produces a verdict on the previous commit wearing this one's sha,
   which is worse than no verdict: on 2026-10-23 it reported a call as still
   being made 40 seconds before the deploy that removed it went live. So wait
   until the deployed page is the one in this checkout. */
const sha256 = (t) => createHash("sha256").update(t).digest("hex");
const wantHash = sha256(readFileSync("index.html", "utf8"));
let deployed = null;
for (let i = 0; i < 40; i++) {
  try {
    const got = await (await fetch(SITE + "index.html?v=" + Date.now(),
      { headers: { "cache-control": "no-cache" } })).text();
    deployed = sha256(got);
    if (deployed === wantHash) break;
  } catch { /* the deploy may be mid-swap */ }
  if (i === 0) console.log("waiting for Pages to publish this commit...");
  await new Promise((r) => setTimeout(r, 15000));
}
const onTheRightBuild = deployed === wantHash;
report.deployment = { matchesCheckout: onTheRightBuild, wanted: wantHash.slice(0, 12), got: (deployed ?? "none").slice(0, 12) };
if (!onTheRightBuild) {
  // Say so loudly and stop, rather than grading the wrong page.
  failures.push("the deployed index.html is not the one in this checkout after 10 minutes"
    + ` (wanted ${wantHash.slice(0, 12)}, served ${(deployed ?? "nothing").slice(0, 12)})`);
  console.log("=== " + failures[0]);
  flush();
  process.exit(1);
}
console.log(`=== the deployed page is this commit (${wantHash.slice(0, 12)})`);

const grab = async (name) => {
  const res = await fetch(SITE + name + "?v=" + Date.now(), { headers: { "cache-control": "no-cache" } });
  return { json: await res.json(), bytes: Number(res.headers.get("content-length") ?? 0) };
};
const snapshot = (await grab("data.json")).json;
const liveFile = await grab("live.json");
const commentaryFile = await grab("commentary.json");

// Prefer a match the live file actually carries commentary for.
const pick = () => {
  for (const lg of ["epl", "liga", "ucl"]) {
    const ids = Object.keys(commentaryFile.json.comps?.[lg] ?? {});
    if (ids.length) return { lg, ev: ids[0], goals: snapshot.comps[lg]?.events?.[ids[0]] ?? [], commented: true };
  }
  for (const lg of ["epl", "liga", "ucl"]) {
    const ids = Object.keys(snapshot.comps[lg]?.events ?? {});
    if (ids.length) return { lg, ev: ids[ids.length - 1], goals: snapshot.comps[lg].events[ids[ids.length - 1]], commented: false };
  }
  return null;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: "dark", timezoneId: "Europe/London" });
page.on("response", (r) => {
  const u = r.url();
  if (/espn\.com|thesportsdb/.test(u)) seen.push(`${r.status()} ${u.replace(/https:\/\/[^/]+/, "").slice(0, 70)}`);
});
page.on("pageerror", (e) => failures.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/net::|Failed to load resource/.test(m.text())) failures.push("console: " + m.text()); });

const age = (iso) => Math.round((Date.now() - new Date(iso).getTime()) / 60000) + "m old";
report.files = {
  data: { generated: snapshot.generated, age: age(snapshot.generated) },
  live: { generated: liveFile.json.generated, age: age(liveFile.json.generated), kb: +(liveFile.bytes / 1024).toFixed(1) },
  commentary: { generated: commentaryFile.json.generated, kb: +(commentaryFile.bytes / 1024).toFixed(1) },
};
console.log("=== files on the server");
console.log(`  data.json       ${age(snapshot.generated)}`);
console.log(`  live.json       ${age(liveFile.json.generated)}  ${(liveFile.bytes / 1024).toFixed(1)}KB`);
console.log(`  commentary.json ${age(commentaryFile.json.generated)}  ${(commentaryFile.bytes / 1024).toFixed(1)}KB`);
for (const lg of ["epl", "liga", "ucl"]) {
  const snapRow = snapshot.comps[lg]?.rows?.[0];
  const liveRow = liveFile.json.comps?.[lg]?.rows?.[0];
  const inPlay = Object.values(liveFile.json.comps?.[lg]?.matches ?? {}).filter(m => m.state === "in").length;
  console.log(`  ${lg}: snapshot says ${snapRow?.short} ${snapRow?.pts}, live says ${liveRow?.short ?? "-"} ${liveRow?.pts ?? "-"}`
    + ` · ${inPlay} in play · commentary for ${Object.keys(commentaryFile.json.comps?.[lg] ?? {}).length}`);
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
const liveLeader = liveFile.json.comps?.epl?.rows?.[0];
console.log("  first paint (the hourly snapshot): " + beforeRefresh);
console.log("  after the live file lands:         " + after.leader);
console.log("  live.json says it should be:       "
  + (liveLeader ? liveLeader.short + " " + liveLeader.pts : "(no table in live.json)"));
report.page = { ...after, firstPaint: beforeRefresh,
  liveShouldBe: liveLeader ? `${liveLeader.short} ${liveLeader.pts}` : null };
console.log("  status pill: " + after.pill + "   chip: " + after.chip);
console.log("  rows: " + after.rows + " · crest images loaded: " + after.crests + "/" + after.crestTotal);
console.log("  top performers: " + after.performers + " rows · tabs: " + after.stats);
console.log("  in-play badges on the page: " + await page.locator(".livedot").count());
console.log("  live-source requests made by the page:");
for (const s of [...new Set(seen)]) console.log("    " + s);
await page.screenshot({ path: `${SHOTS}/screenshot-table.png` });

const match = pick();
if (match) {
  console.log(`\n=== a real match page (${match.lg} ${match.ev}, ${match.goals.length} goal(s) in the snapshot)`);
  await page.goto(`${SITE}#${match.lg}/match/${match.ev}`, { waitUntil: "load" });
  // commentary.json is refreshed far more often than the snapshot, so it can
  // name a match the snapshot has not caught up with. Worth reporting; not
  // worth killing the run and losing the screenshots over.
  const rendered = await page.waitForSelector(".mhead", { timeout: 20000 }).then(() => true).catch(() => false);
  if (!rendered) failures.push(`the match page for ${match.lg}/${match.ev} never rendered`
    + " — the snapshot probably does not carry that fixture yet");
  if (rendered) await page.waitForSelector(".feed .line", { timeout: 20000 }).catch(() => {});
  const m = !rendered ? { teams: null, score: null, goals: [], lines: 0, first: null } : await page.evaluate(() => ({
    teams: [...document.querySelectorAll(".team .nm")].map(e => e.textContent.trim()).join(" v "),
    score: document.querySelector(".bigscore")?.textContent.trim(),
    goals: [...document.querySelectorAll(".sheet .goal")].map(e => e.textContent.replace(/\s+/g, " ").trim()),
    lines: document.querySelectorAll(".feed .line").length,
    first: document.querySelector(".feed .line span:last-child")?.textContent.trim().slice(0, 120) ?? null
  }));
  console.log("  " + m.teams + "   " + m.score);
  console.log("  scorers: " + (m.goals.join(" · ") || "(none)"));
  console.log("  commentary lines: " + m.lines
    + (match.commented ? " (this match is in commentary.json)" : " (not a match the live file covers)"));
  report.match = { ...m, lg: match.lg, ev: match.ev, inCommentaryFile: match.commented };
  if (m.first) console.log("  latest line: " + m.first);
  await page.screenshot({ path: `${SHOTS}/screenshot-match.png` });
}

// Whichever competition has a match on right now is the one worth looking at.
console.log("\n=== live scores, per competition");
for (const lg of ["epl", "liga", "ucl"]) {
  await page.goto(`${SITE}#${lg}`, { waitUntil: "load" });
  await page.waitForSelector(".trow[data-club]", { timeout: 20000 });
  await page.waitForTimeout(3500);
  const seen = await page.evaluate(() => ({
    badges: document.querySelectorAll(".livedot").length,
    strip: [...document.querySelectorAll(".sect")].find(s => /In play/.test(s.textContent))
      ?.textContent.replace(/\s+/g, " ").trim() ?? null,
    leader: document.querySelector(".trow .nm")?.textContent.trim()
      + " " + document.querySelector(".trow .pts")?.textContent.trim(),
    note: document.querySelector(".note")?.textContent.replace(/\s+/g, " ").trim().slice(0, 100)
  }));
  report.perCompetition[lg] = seen;
  console.log(`  ${lg}: leader ${seen.leader} · ${seen.badges} club(s) in play`
    + (seen.strip ? `\n     ${seen.strip}` : ""));
  if (seen.badges) await page.screenshot({ path: `${SHOTS}/screenshot-live.png` });
}

const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: "dark", timezoneId: "Europe/London" });
await phone.goto(SITE + "#liga", { waitUntil: "load" });
await phone.waitForSelector(".trow[data-club]", { timeout: 20000 });
await phone.waitForTimeout(3500);
const over = await phone.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
console.log("\n=== phone at 390px: horizontal overflow " + over + "px");
report.phone = { overflowPx: over };
await phone.screenshot({ path: `${SHOTS}/screenshot-phone.png` });

await browser.close();
console.log("\n=== " + (failures.length ? failures.length + " page error(s)" : "no page errors"));
for (const f of failures) console.log("  " + f);
process.exit(failures.length ? 1 : 0);
