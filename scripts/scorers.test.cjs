// Unit-tests scorersFrom against the shape the probe recorded, including the
// own-goal reconciliation, by evaluating the function straight out of the source.
const fs = require("node:fs");
const src = fs.readFileSync(__dirname + "/fulltime/scripts/update-standings.mjs", "utf8");
const start = src.indexOf("function scorersFrom(");
const end = src.indexOf("\n}\n", start) + 3;
const scorersFrom = eval("(" + src.slice(start, end).replace(/^function scorersFrom/, "function") + ")");

const bad = [];
const check = (ok, m) => { console.log((ok ? "  ok   " : "  FAIL ") + m); if (!ok) bad.push(m); };
const detail = (o) => ({
  type: { text: o.type ?? "Goal" }, clock: { displayValue: o.minute },
  team: { id: o.team }, scoreValue: 1, scoringPlay: true,
  ownGoal: !!o.own, penaltyKick: !!o.pen, shootout: !!o.shootout,
  athletesInvolved: [{ displayName: o.name, shortName: o.name }]
});

// straightforward: two home, one away
let out = scorersFrom({ details: [
  detail({ minute: "15'", team: "359", name: "K. Havertz" }),
  detail({ minute: "23'", team: "359", name: "B. Saka", pen: true }),
  detail({ minute: "67'", team: "337", name: "K. Schade" })
]}, "359", 2, 1);
check(out.length === 3, "three goals parsed");
check(out[0][0] === "15" && out[0][1] === "K. Havertz" && out[0][2] === 1 && out[0][3] === "",
  "minute, scorer, side and kind: " + JSON.stringify(out[0]));
check(out[1][3] === "p", "penalty flagged");
check(out[2][2] === 0, "away goal attributed away");

// an own goal ESPN credits to the scorer's own team: the tally must reconcile
out = scorersFrom({ details: [
  detail({ minute: "12'", team: "359", name: "K. Havertz" }),
  detail({ minute: "44'", team: "359", name: "W. Saliba", own: true })
]}, "359", 1, 1);
check(out.filter(g => g[2] === 1).length === 1 && out.filter(g => g[2] === 0).length === 1,
  "own goal flipped to the side it counted for: " + JSON.stringify(out));
check(out.find(g => g[3] === "o") !== undefined, "and still marked as an own goal");

// an own goal already credited correctly must not be flipped
out = scorersFrom({ details: [
  detail({ minute: "12'", team: "359", name: "K. Havertz" }),
  detail({ minute: "44'", team: "337", name: "W. Saliba", own: true })
]}, "359", 1, 1);
check(out.filter(g => g[2] === 1).length === 1, "a correct own goal is left alone: " + JSON.stringify(out));

// shootouts and unnamed plays are ignored; unplayed matches parse untouched
out = scorersFrom({ details: [
  detail({ minute: "120'", team: "359", name: "M. Odegaard", shootout: true }),
  { scoringPlay: true, clock: { displayValue: "5'" }, team: { id: "359" }, athletesInvolved: [] }
]}, "359", 0, 0);
check(out.length === 0, "shootout and nameless plays skipped");
out = scorersFrom({ details: [detail({ minute: "15'", team: "359", name: "K. Havertz" })] }, "359", null, null);
check(out.length === 1, "an in-progress match keeps what it has");
check(scorersFrom({}, "359", 0, 0).length === 0, "a match with no detail yields nothing");

console.log("\n== " + (bad.length ? bad.length + " problem(s)" : "scorersFrom behaves"));
process.exit(bad.length ? 1 : 0);
