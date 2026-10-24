// Unit-tests the snapshot format's two halves against each other.
//
// compact() in scripts/update-standings.mjs writes data.json; expand() in
// index.html reads it. They are inverses, they live in different files, and
// nothing else checks that they still agree. If they drift the failure is total
// and silent: the job writes a snapshot the page cannot expand, the page draws
// an empty league, and the guard sees a file full of data and passes it.
//
// Both are lifted out of the shipped sources rather than reimplemented, so this
// cannot quietly test a copy that is no longer what runs.
const fs = require("node:fs");

const mjs = fs.readFileSync(__dirname + "/update-standings.mjs", "utf8");
const page = fs.readFileSync(__dirname + "/../index.html", "utf8");

// Slice a declaration out of a shipped source, from its opening line to the
// closer that ends it, and fail loudly if either has moved.
const lift = (src, header, closer) => {
  const start = src.indexOf(header);
  if (start < 0) throw new Error(`${header} not found — renamed or reshaped?`);
  const end = src.indexOf(closer, start);
  if (end < 0) throw new Error(`${header} has no ${JSON.stringify(closer)} after it`);
  return src.slice(start, end + closer.length);
};

const { compact, expand, pageLOGO, updaterLOGO } = eval(`(() => {
  ${lift(mjs, "export function compact(c) {", "\n}\n").replace("export ", "")}
  ${lift(mjs, "export const LOGO =", ";\n").replace("export const LOGO =", "const updaterLOGO =")}
  ${lift(page, "const LOGO = id =>", ";\n").replace("const LOGO =", "const pageLOGO =")}
  const LOGO = pageLOGO;
  ${lift(page, "const fillRow = r => ({", "});\n")}
  ${lift(page, "const withFixtures = (rest, rows, fixtures) =>", "{...rest, rows};\n")}
  ${lift(page, "function expand(c){", "\n}\n")}
  return { compact, expand, pageLOGO, updaterLOGO };
})()`);

const bad = [];
const check = (ok, m) => { console.log((ok ? "  ok   " : "  FAIL ") + m); if (!ok) bad.push(m); };
const same = (a, b, m) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  check(x === y, m + (x === y ? "" : `\n         wrote ${y}\n         read  ${x}`));
};

/* Build the per-club shape the updater produces before packing: every match
   under both clubs, each club's list in date order. */
const v1 = (rows, matches) => {
  const fixtures = {};
  const put = (club, t) => (fixtures[club] ??= []).push(t);
  for (const m of matches) {
    put(m.home, [m.md ?? null, m.date ?? null, m.time ?? null, m.away, 1, m.hg ?? null, m.ag ?? null, m.ev ?? null]);
    put(m.away, [m.md ?? null, m.date ?? null, m.time ?? null, m.home, 0, m.ag ?? null, m.hg ?? null, m.ev ?? null]);
  }
  for (const list of Object.values(fixtures)) list.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  return { name: "Test League", matchday: 2, rows, fixtures, leaders: { goals: [] } };
};
const ROWS = [
  { pos: 1, id: "11", team: "Arsenal FC", short: "Arsenal", p: 2, w: 2, d: 0, l: 0, gf: 5, ga: 1, gd: 4, pts: 6, form: "WW", logo: "https://a.espncdn.com/i/teamlogos/soccer/500/11.png" },
  { pos: 2, id: "22", team: "Chelsea FC", short: "Chelsea", p: 2, w: 1, d: 0, l: 1, gf: 3, ga: 3, gd: 0, pts: 3, form: "LW", logo: "https://a.espncdn.com/i/teamlogos/soccer/500/22.png" },
  { pos: 3, id: "33", team: "Everton FC", short: "Everton", p: 2, w: 0, d: 0, l: 2, gf: 1, ga: 5, gd: -4, pts: 0, form: "LL", logo: "https://a.espncdn.com/i/teamlogos/soccer/500/33.png" },
];
const MATCHES = [
  { md: 1, date: "2026-08-21", time: "19:00Z", home: "Arsenal", away: "Chelsea", hg: 3, ag: 1, ev: "401" },
  { md: 1, date: "2026-08-21", time: "19:00Z", home: "Everton", away: "Arsenal", hg: 0, ag: 2, ev: "402" },
  { md: 2, date: "2026-08-28", time: "15:00Z", home: "Chelsea", away: "Everton", hg: 2, ag: 1, ev: "403" },
  { md: 3, date: "2026-09-04", time: "15:00Z", home: "Arsenal", away: "Everton", ev: "404" },   // to come, id known
  { md: 4, date: "2026-09-11", time: null,     home: "Chelsea", away: "Arsenal" },              // to come, nothing known
];

console.log("== the round trip is exact");
const original = v1(ROWS, MATCHES);
const packed = compact(JSON.parse(JSON.stringify(original)));
const back = expand(JSON.parse(JSON.stringify(packed)));
for (const club of Object.keys(original.fixtures))
  same(back.fixtures[club], original.fixtures[club], `${club}'s fixtures survive the round trip`);
check(Object.keys(back.fixtures).sort().join() === Object.keys(original.fixtures).sort().join(),
  "and no club is gained or lost");

console.log("\n== the packing does what it claims");
check(packed.matches.length === MATCHES.length,
  `${MATCHES.length} matches stored once, not ${MATCHES.length * 2} times (${packed.matches.length})`);
check(packed.dates.length === 4, `dates are interned: 4 distinct for 5 matches (${packed.dates.length})`);
check(packed.times.length === 2, `times too: 2 distinct, the unknown one stored as -1 (${packed.times.length})`);
check(packed.clubs.length === 3, `clubs come from the rows (${packed.clubs.join(", ")})`);
const noneKnown = packed.matches.find((t) => t.length < 8);
check(!!noneKnown && noneKnown.length === 5,
  `a match with no score and no id drops its trailing nulls: ${JSON.stringify(noneKnown)}`);
const idKnown = packed.matches.find((t) => t.length === 8 && t[5] === null);
check(!!idKnown, `one still to play but already identified keeps all eight: ${JSON.stringify(idKnown)}`);

console.log("\n== rows lose only what can be worked out again");
check(!("logo" in packed.rows[0]) && !("gd" in packed.rows[0]), "the packed rows carry neither logo nor gd");
check(back.rows[0].logo === ROWS[0].logo, `expand rebuilds the crest URL (${back.rows[0].logo})`);
check(back.rows[2].gd === -4, `and the goal difference (${back.rows[2].gd})`);
for (const k of ["pos", "id", "team", "short", "p", "w", "d", "l", "gf", "ga", "pts", "form"])
  if (back.rows[0][k] !== ROWS[0][k]) check(false, `row field ${k} survives`);
check(true, "every other row field is untouched");
check(expand({ rows: [{ short: "X", gf: 1, ga: 0 }] }).rows[0].logo === null,
  "a row with no id gets a null crest rather than a broken URL");
check(pageLOGO("11") === updaterLOGO("11"),
  `both files agree on the crest URL (${pageLOGO("11")})`);

console.log("\n== the two copies of a match are folded, keeping what is known");
const half = v1(ROWS, [{ md: 1, date: "2026-08-21", time: "19:00Z", home: "Arsenal", away: "Chelsea", hg: 3, ag: 1 }]);
half.fixtures.Chelsea[0][5] = null;           // the away club has not heard the score
half.fixtures.Chelsea[0][6] = null;
half.fixtures.Chelsea[0][7] = "999";          // but it does know the event id
const folded = compact(half);
check(folded.matches.length === 1, "the two copies become one match");
same(folded.matches[0].slice(5, 7), [3, 1], "the copy that knows the score wins");
check(folded.matches[0][7] === "999", `and an id only the other copy had is carried across (${folded.matches[0][7]})`);

console.log("\n== competitions with nothing to pack");
const notStarted = { name: "Cup", notStarted: true };
same(compact(notStarted), notStarted, "a competition with no fixtures passes through compact untouched");
check(!("fixtures" in expand({ rows: [], matches: [], clubs: [], dates: [], times: [] })),
  "an empty match list expands to NO fixtures key, not an empty object that reads as truthy");
check(!("fixtures" in expand({ rows: [], fixtures: {} })),
  "and neither does an empty fixtures map arriving in the older shape");
const v1Passthrough = { rows: ROWS, fixtures: v1(ROWS, MATCHES).fixtures };
check("fixtures" in expand(v1Passthrough), "while a populated older snapshot still expands");

console.log("\n== a club that plays but is not in the table");
const guest = v1(ROWS, [...MATCHES, { md: 5, date: "2026-09-18", time: "15:00Z", home: "Arsenal", away: "Wildcard", hg: 1, ag: 1 }]);
const gPacked = compact(JSON.parse(JSON.stringify(guest)));
check(gPacked.clubs.includes("Wildcard"), "compact appends it to the club table");
const gBack = expand(JSON.parse(JSON.stringify(gPacked)));
same(gBack.fixtures.Wildcard, guest.fixtures.Wildcard, "and its fixtures round-trip like any other club's");

console.log("\n== against the snapshot actually committed here");
let live = null;
try { live = JSON.parse(fs.readFileSync(__dirname + "/../data.json", "utf8")); } catch {}
if (!live) console.log("  --   no data.json to read, skipping");
else for (const [lg, c] of Object.entries(live.comps ?? {})) {
  if (!Array.isArray(c.matches) || !c.matches.length) continue;
  const out = expand(JSON.parse(JSON.stringify(c)));
  const clubs = Object.keys(out.fixtures ?? {});
  const perClub = clubs.map((k) => out.fixtures[k].length);
  const named = new Set(c.matches.flatMap((t) => [c.clubs[t[3]], c.clubs[t[4]]]));
  check(clubs.length === named.size && perClub.every((n) => n > 0),
    `${lg}: every one of the ${named.size} clubs named by a match gets fixtures, ${Math.min(...perClub)}-${Math.max(...perClub)} each`);
  check(out.fixtures[clubs[0]].every((t) => t.length === 8),
    `${lg}: every expanded tuple has all eight fields`);
  // And packing what we just expanded gets the same file back.
  const repacked = compact({ ...out, rows: c.rows.map((r) => ({ ...r })) });
  check(repacked.matches.length === c.matches.length,
    `${lg}: re-packing the expansion yields the same ${c.matches.length} matches`);
}

console.log(bad.length ? `\n== ${bad.length} problem(s)` : "\n== compact and expand still agree");
process.exit(bad.length ? 1 : 0);
