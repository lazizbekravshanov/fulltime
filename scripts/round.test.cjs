// Unit-tests currentRound — which round the page calls "current". It is lifted
// straight out of index.html so the test cannot drift from the shipped copy.
const fs = require("node:fs");
const page = fs.readFileSync(__dirname + "/../index.html", "utf8");
const start = page.indexOf("function currentRound(");
if (start < 0) throw new Error("currentRound not found in index.html");
const end = page.indexOf("\n}\n", start) + 3;
const currentRound = eval(`(${page.slice(start, end).replace(/^function currentRound/, "function")})`);

const bad = [];
const check = (ok, m) => { console.log((ok ? "  ok   " : "  FAIL ") + m); if (!ok) bad.push(m); };

// A round is a list of matches, each knowing only whether it has been played.
const season = (spec) => new Map(Object.entries(spec).map(([md, played]) => {
  const [done, total] = Array.isArray(played) ? played : [played, played];
  return [Number(md), Array.from({ length: total }, (_, i) => ({ done: i < done }))];
}));

console.log("== the ordinary case");
check(currentRound(season({ 1: 10, 2: 10, 3: 10, 4: [0, 10], 5: [0, 10] })) === 3,
  "three rounds played, two to come -> 3");
check(currentRound(season({ 1: 10, 2: [4, 10] })) === 2,
  "a round half played is the current one -> 2");

console.log("\n== a rescheduled fixture must not pin it to the past");
// La Liga, 2026-10-14: one match of round 6 moved to 21 October while rounds 7
// and 8 went ahead. The old rule returned 6; the header said 8.
const liga = season({ 1: 10, 2: 10, 3: 10, 4: 10, 5: 10, 6: [9, 10], 7: 10, 8: [9, 10], 9: [0, 10], 10: [0, 10] });
check(currentRound(liga) === 8, `one match of round 6 held over, league on 8 -> ${currentRound(liga)}`);
const twoHeldOver = season({ 1: [9, 10], 2: 10, 3: [8, 10], 4: 10, 5: [0, 10] });
check(currentRound(twoHeldOver) === 4, `two earlier rounds part-played -> ${currentRound(twoHeldOver)}`);

console.log("\n== the ends of a season");
check(currentRound(season({ 1: [0, 10], 2: [0, 10], 3: [0, 10] })) === 1,
  "nothing played yet -> the opening round, not the last");
check(currentRound(season({ 1: 10, 2: 10, 3: 10 })) === 3, "every match played -> the final round");
check(currentRound(new Map()) === 1, "no rounds at all -> 1 rather than undefined");

console.log("\n== rounds out of numerical order in the map");
const shuffled = new Map([[3, [{ done: false }]], [1, [{ done: true }]], [2, [{ done: true }]]]);
check(currentRound(shuffled) === 2, "insertion order is ignored, the numbers decide");

// The matchday number on the rows comes from ESPN's standings while the round
// numbers on the fixtures come from openfootball, so the two disagreeing is a
// data quirk, not a code fault. Worth reporting on every run; not worth failing
// an hourly refresh over.
console.log("\n== against the shipped snapshot (reported, not enforced)");
let snap = null;
try { snap = JSON.parse(fs.readFileSync(__dirname + "/../data.json", "utf8")); } catch {}
if (!snap) {
  console.log("  --   no data.json to check against, skipping");
} else {
  for (const [lg, c] of Object.entries(snap.comps ?? {})) {
    if (!Array.isArray(c.matches) || !c.matches.length || c.matchday == null) continue;
    const rounds = new Map();
    for (const [md, , , , , hg = null] of c.matches) {
      if (md == null) continue;
      if (!rounds.has(md)) rounds.set(md, []);
      rounds.get(md).push({ done: hg != null });
    }
    const got = currentRound(rounds);
    console.log(got === c.matchday
      ? `  ok   ${lg}: currentRound ${got} matches the feed's matchday ${c.matchday}`
      : `  note ${lg}: currentRound says ${got}, the standings feed says ${c.matchday}`
        + ` — the two number their rounds separately, so this is worth an eye, not a failure`);
  }
}

console.log(bad.length ? `\n== ${bad.length} problem(s)` : "\n== currentRound names the round the competition is on");
process.exit(bad.length ? 1 : 0);
