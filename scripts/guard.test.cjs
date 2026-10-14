// Unit-tests the snapshot guard — the thing that would have caught the ESPN
// scoreboard breaking on 2026-09-16 instead of letting it ship for 29 days.
// capabilities() and regressions() are pure, so they are evaluated straight out
// of the source rather than imported, keeping this a dependency-free CJS test.
const fs = require("node:fs");
const src = fs.readFileSync(__dirname + "/update-standings.mjs", "utf8");
const lift = (name) => {
  const start = src.indexOf(`export function ${name}(`);
  if (start < 0) throw new Error(`${name} not found in update-standings.mjs`);
  const end = src.indexOf("\n}\n", start) + 3;
  return src.slice(start, end).replace(/^export function/, "function");
};
const { capabilities, regressions } = eval(
  `(() => { ${lift("capabilities")} ${lift("regressions")} return { capabilities, regressions }; })()`
);

const bad = [];
const check = (ok, m) => { console.log((ok ? "  ok   " : "  FAIL ") + m); if (!ok) bad.push(m); };
const eq = (a, b, m) => check(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)}`);

// A competition in the compact form the job writes today. Two matches, one
// played and carrying an event id, one still to come.
const v2 = (over = {}) => ({
  comps: { epl: {
    rows: [{ short: "A" }, { short: "B" }],
    clubs: ["A", "B"], dates: ["2026-08-21"], times: ["19:00Z"],
    matches: [[1, 0, 0, 0, 1, 2, 1, "401"], [2, 0, 0, 1, 0]],
    events: { 401: [[12, "Someone", 1, ""]] },
    leaders: { goals: [], assists: [] },
    ...over,
  } },
});

// The same two matches in the older per-club form, where each one appears twice.
const v1 = {
  comps: { epl: {
    rows: [{ short: "A" }, { short: "B" }],
    fixtures: {
      A: [[1, "2026-08-21", "19:00Z", "B", 1, 2, 1, "401"], [2, "2026-08-21", "19:00Z", "B", 0, null, null, null]],
      B: [[1, "2026-08-21", "19:00Z", "A", 0, 1, 2, "401"], [2, "2026-08-21", "19:00Z", "A", 1, null, null, null]],
    },
    events: { 401: [[12, "Someone", 1, ""]] },
    leaders: { goals: [], assists: [] },
  } },
};

console.log("== capabilities reads both snapshot shapes the same way");
eq(capabilities(v2()).epl, { rows: 2, fixtures: 2, results: 1, eventIds: 1, scorers: 1, leaders: 2 },
  "the compact form");
eq(capabilities(v1).epl, { rows: 2, fixtures: 2, results: 1, eventIds: 1, scorers: 1, leaders: 2 },
  "the per-club form, with matches de-doubled");
eq(capabilities(v1).epl, capabilities(v2()).epl,
  "the same data counts identically either way, so a format change is never read as a loss");
eq(capabilities({}), {}, "an empty snapshot");
eq(capabilities(null), {}, "no snapshot at all");

console.log("\n== regressions flags a capability that went to zero");
const full = capabilities(v2());
const noEvents = capabilities(v2({ matches: [[1, 0, 0, 0, 1, 2, 1], [2, 0, 0, 1, 0]], events: {} }));
const r1 = regressions(full, noEvents);
check(r1.errors.length === 2, `losing event ids and scorers is 2 errors: ${r1.errors.join("; ")}`);
check(r1.errors.every(e => /-> 0$/.test(e)), "and each one names the drop to zero");

const noFixtures = capabilities(v2({ matches: [], clubs: [], events: {} }));
check(regressions(full, noFixtures).errors.some(e => e.startsWith("epl.fixtures")),
  "a competition losing its whole fixture list is an error");

check(regressions(full, {}).errors.some(e => /gone from the snapshot entirely/.test(e)),
  "a competition vanishing is an error");

console.log("\n== and stays quiet when nothing was lost");
check(regressions(full, full).errors.length === 0, "an identical snapshot is clean");
check(regressions(full, capabilities(v1)).errors.length === 0,
  "and so is the same data in the other shape");
const grew = capabilities(v2({ matches: [[1, 0, 0, 0, 1, 2, 1, "401"], [2, 0, 0, 1, 0, 0, 0, "402"]] }));
check(regressions(full, grew).errors.length === 0, "a snapshot that gained a result is clean");
check(regressions({ epl: { fixtures: 0 } }, { epl: { fixtures: 0 } }).errors.length === 0,
  "something that was always zero is not a regression");

console.log("\n== a big drop that is not total warns rather than fails");
const half = regressions({ epl: { eventIds: 100 } }, { epl: { eventIds: 20 } });
check(half.errors.length === 0 && half.warnings.length === 1, `100 -> 20 warns: ${half.warnings.join("")}`);
const small = regressions({ epl: { eventIds: 100 } }, { epl: { eventIds: 80 } });
check(small.warnings.length === 0, "100 -> 80 is ordinary movement and says nothing");
const tiny = regressions({ epl: { eventIds: 10 } }, { epl: { eventIds: 3 } });
check(tiny.warnings.length === 0, "small numbers do not warn on noise");

console.log("\n== the shape of the real break, in miniature");
const was = { epl: { rows: 20, fixtures: 380, results: 40, eventIds: 760, scorers: 36, leaders: 6 },
              ucl: { rows: 36, fixtures: 144, results: 18, eventIds: 288, scorers: 18, leaders: 6 } };
const now = { epl: { rows: 20, fixtures: 380, results: 28, eventIds: 0, scorers: 0, leaders: 6 },
              ucl: { rows: 36, fixtures: 0, results: 0, eventIds: 0, scorers: 0, leaders: 6 } };
const real = regressions(was, now);
check(real.errors.length === 6, `2026-09-16 would have produced 6 errors: ${real.errors.length}`);
check(real.errors.some(e => e === "ucl.fixtures: 144 -> 0"), "including the Champions League losing its fixtures");
check(real.errors.some(e => e === "epl.eventIds: 760 -> 0"), "and the Premier League losing its event ids");
check(!real.errors.some(e => e.startsWith("epl.rows")), "while the standings, which never broke, are not blamed");

console.log(bad.length ? `\n== ${bad.length} problem(s)` : "\n== the snapshot guard behaves");
process.exit(bad.length ? 1 : 0);
