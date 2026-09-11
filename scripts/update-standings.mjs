// Refreshes league-tables/data.json with current standings.
// Primary source: ESPN's public standings feed (has ranks, GF/GA and crest URLs).
// Fallback + form source: openfootball/football.json (open data, tables computed
// here from match results — tiebreak approximated as pts, GD, GF).
// No dependencies; requires Node 18+.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data.json");

// European seasons start in August; before July we are still in last year's season.
const now = new Date();
const startYear = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
const seasonLabel = `${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
const ofSeason = `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;

const COMPS = {
  epl: { name: "Premier League", espn: "eng.1", of: `${ofSeason}/en.1.json` },
  liga: { name: "La Liga", espn: "esp.1", of: `${ofSeason}/es.1.json` },
  ucl: { name: "Champions League", espn: "uefa.champions", of: null },
};

const SHORT_NAMES = {
  "afc bournemouth": "Bournemouth",
  "brighton & hove albion": "Brighton",
  "brighton and hove albion": "Brighton",
  "coventry city": "Coventry",
  "crystal palace": "Crystal Palace",
  "hull city": "Hull City",
  "ipswich town": "Ipswich",
  "leeds united": "Leeds",
  "manchester city": "Man City",
  "manchester united": "Man United",
  "newcastle united": "Newcastle",
  "nottingham forest": "Nott'm Forest",
  "tottenham hotspur": "Tottenham",
  "west ham united": "West Ham",
  "wolverhampton wanderers": "Wolves",
  "ca osasuna": "Osasuna",
  "club atletico de madrid": "Atlético Madrid",
  "atletico madrid": "Atlético Madrid",
  "deportivo alaves": "Alavés",
  "fc barcelona": "Barcelona",
  "levante ud": "Levante",
  "malaga cf": "Málaga",
  "rc celta de vigo": "Celta Vigo",
  "celta vigo": "Celta Vigo",
  "rc deportivo la coruna": "Deportivo",
  "deportivo la coruna": "Deportivo",
  "rcd espanyol de barcelona": "Espanyol",
  "rayo vallecano de madrid": "Rayo Vallecano",
  "real betis balompie": "Real Betis",
  "real madrid cf": "Real Madrid",
  "real racing club de santander": "Racing Santander",
  "racing santander": "Racing Santander",
  "real sociedad de futbol": "Real Sociedad",
  "athletic club": "Athletic Club",
  "rcd mallorca": "Mallorca",
  "paris saint-germain": "PSG",
  "bayern munich": "Bayern Munich",
  "fc bayern munchen": "Bayern Munich",
  "borussia dortmund": "Dortmund",
  "bayer leverkusen": "Leverkusen",
  "internazionale": "Inter",
  "inter milan": "Inter",
  "sporting cp": "Sporting CP",
  "sl benfica": "Benfica",
  "fc porto": "Porto",
  "as monaco": "Monaco",
  "olympique marseille": "Marseille",
  "club brugge": "Club Brugge",
  "union saint-gilloise": "Union SG",
  "psv eindhoven": "PSV",
  "afc ajax": "Ajax",
  "eintracht frankfurt": "Frankfurt",
  "slavia prague": "Slavia Prague",
  "bodo/glimt": "Bodø/Glimt",
};

const strip = (s) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,']/g, "")
    .trim();

const dropTokens = new Set(["fc", "afc", "cf", "cd", "ca", "ud", "rc", "rcd", "sc", "ac", "as", "sl", "club", "de", "the", "balompie"]);

function shortName(name) {
  const key = strip(name);
  if (SHORT_NAMES[key]) return SHORT_NAMES[key];
  const tokens = key.split(/\s+/).filter((t) => !dropTokens.has(t));
  const cleanedKey = tokens.join(" ");
  if (SHORT_NAMES[cleanedKey]) return SHORT_NAMES[cleanedKey];
  // Title-case what's left of the original name after dropping suffix tokens.
  const orig = name.replace(/[.,]/g, "").split(/\s+/);
  const kept = orig.filter((t) => !dropTokens.has(strip(t)));
  return kept.join(" ") || name;
}

// Loose matcher so ESPN and openfootball names can be joined (e.g. "Brighton &
// Hove Albion" vs "Brighton & Hove Albion FC").
function nameKey(name) {
  return strip(name)
    .replace(/&/g, "and")
    .split(/\s+/)
    .filter((t) => !dropTokens.has(t))
    .sort()
    .join(" ");
}

async function getJSON(url) {
  const res = await fetch(url, { headers: { "user-agent": "league-tables-updater" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function computeFromOpenfootball(data) {
  const table = new Map();
  const t = (name) => {
    if (!table.has(name))
      table.set(name, { team: name, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, results: [] });
    return table.get(name);
  };
  let matchday = 0;
  for (const m of data.matches ?? []) {
    // Seed every club from the fixture list so sides without a completed
    // match yet still appear in the table.
    if (m.team1) t(m.team1);
    if (m.team2) t(m.team2);
    const ft = m?.score?.ft;
    if (!Array.isArray(ft) || ft.length !== 2) continue;
    const [g1, g2] = ft;
    const a = t(m.team1);
    const b = t(m.team2);
    a.p++; b.p++;
    a.gf += g1; a.ga += g2;
    b.gf += g2; b.ga += g1;
    if (g1 > g2) { a.w++; b.l++; a.results.push([m.date, "W"]); b.results.push([m.date, "L"]); }
    else if (g1 < g2) { b.w++; a.l++; a.results.push([m.date, "L"]); b.results.push([m.date, "W"]); }
    else { a.d++; b.d++; a.results.push([m.date, "D"]); b.results.push([m.date, "D"]); }
    const md = parseInt(String(m.round ?? "").replace(/\D+/g, ""), 10);
    if (md > matchday) matchday = md;
  }
  const rows = [...table.values()].map((r) => ({
    ...r,
    gd: r.gf - r.ga,
    pts: r.w * 3 + r.d,
    form: r.results
      .sort((x, y) => String(x[0]).localeCompare(String(y[0])))
      .slice(-5)
      .map((x) => x[1])
      .join(""),
  }));
  rows.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.team.localeCompare(y.team));
  return {
    matchday,
    rows: rows.map((r, i) => ({
      pos: i + 1,
      team: r.team,
      short: shortName(r.team),
      p: r.p, w: r.w, d: r.d, l: r.l, gf: r.gf, ga: r.ga, gd: r.gd, pts: r.pts,
      form: r.form,
      logo: null,
    })),
  };
}

function stat(entry, ...names) {
  for (const n of names) {
    const s = (entry.stats ?? []).find((st) => st.name === n || st.type === n);
    if (s && typeof s.value === "number") return s.value;
  }
  return null;
}

function parseESPN(json) {
  const children = json.children ?? [];
  let entries = children.flatMap((c) => c.standings?.entries ?? []);
  if (!entries.length) entries = json.standings?.entries ?? [];
  if (!entries.length) return null;
  const rows = entries.map((e) => {
    const gf = stat(e, "pointsFor");
    const ga = stat(e, "pointsAgainst");
    return {
      pos: stat(e, "rank"),
      id: e.team?.id ?? null,
      team: e.team?.displayName ?? e.team?.name ?? "?",
      short: shortName(e.team?.shortDisplayName ?? e.team?.displayName ?? "?"),
      p: stat(e, "gamesPlayed"),
      w: stat(e, "wins"),
      d: stat(e, "ties"),
      l: stat(e, "losses"),
      gf, ga,
      gd: stat(e, "pointDifferential") ?? (gf != null && ga != null ? gf - ga : null),
      pts: stat(e, "points"),
      form: "",
      logo: e.team?.logos?.[0]?.href ?? null,
    };
  });
  rows.sort((x, y) => (x.pos ?? 99) - (y.pos ?? 99) || y.pts - x.pts || y.gd - x.gd);
  rows.forEach((r, i) => { if (r.pos == null) r.pos = i + 1; });
  const matchday = Math.max(0, ...rows.map((r) => r.p ?? 0));
  return { matchday, rows };
}

// Fixture tuples are [matchday, date, time, opponent, home?1:0, goalsFor, goalsAgainst];
// goals are null until a match is played. Baking them into data.json keeps the
// page free of runtime fetches. Clubs are keyed by their raw feed name here and
// renamed to the table's short names by alignFixtures().
function fixturesFromOpenfootball(data) {
  const out = {};
  for (const m of data.matches ?? []) {
    if (!m.team1 || !m.team2) continue;
    const md = parseInt(String(m.round ?? "").replace(/\D+/g, ""), 10) || null;
    const ft = Array.isArray(m?.score?.ft) ? m.score.ft : null;
    (out[m.team1] ??= []).push([md, m.date ?? null, m.time ?? null, m.team2, 1, ft ? ft[0] : null, ft ? ft[1] : null]);
    (out[m.team2] ??= []).push([md, m.date ?? null, m.time ?? null, m.team1, 0, ft ? ft[1] : null, ft ? ft[0] : null]);
  }
  return out;
}

// ESPN's scoreboard, walked a month at a time. The per-team schedule feed only
// returns matches already played, so it cannot carry a full season; this one
// lists scheduled fixtures too, and is the only source that covers the
// Champions League, which openfootball does not publish.
async function fixturesFromESPN(slug, year) {
  const out = {};
  const seen = new Set();
  const goals = (side) => {
    const raw = side?.score;
    const value = raw && typeof raw === "object" ? raw.value ?? raw.displayValue : raw;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  for (let i = 0; i < 11; i++) {
    const first = new Date(Date.UTC(year, 7 + i, 1));
    const y = first.getUTCFullYear();
    const mo = String(first.getUTCMonth() + 1).padStart(2, "0");
    const last = new Date(Date.UTC(y, first.getUTCMonth() + 1, 0)).getUTCDate();
    const range = `${y}${mo}01-${y}${mo}${last}`;
    let feed;
    try {
      feed = await getJSON(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${range}&limit=500`
      );
    } catch (e) {
      console.error(`[fixtures] ${slug} ${range}: ${e.message}`);
      continue;
    }
    for (const event of feed.events ?? []) {
      if (event.id && seen.has(event.id)) continue;
      if (event.id) seen.add(event.id);
      const game = event.competitions?.[0];
      if (!game) continue;
      const home = (game.competitors ?? []).find((c) => c.homeAway === "home");
      const away = (game.competitors ?? []).find((c) => c.homeAway === "away");
      if (!home?.team || !away?.team) continue;
      const played = game.status?.type?.completed === true;
      const iso = String(game.date ?? event.date ?? "");
      const date = iso.slice(0, 10) || null;
      const time = iso.length > 11 ? iso.slice(11, 16) + "Z" : null;
      const hn = home.team.displayName ?? home.team.name ?? "?";
      const an = away.team.displayName ?? away.team.name ?? "?";
      const hg = played ? goals(home) : null;
      const ag = played ? goals(away) : null;
      (out[hn] ??= []).push([null, date, time, an, 1, hg, ag]);
      (out[an] ??= []).push([null, date, time, hn, 0, ag, hg]);
    }
  }
  return out;
}

// Feeds name clubs differently ("Nottingham Forest FC" vs ESPN's "Nottm Forest"),
// so re-key fixtures onto exactly the names the table shows.
function alignFixtures(fixtures, rows) {
  const byKey = new Map(rows.map((r) => [nameKey(r.team), r.short]));
  const byTokens = rows.map((r) => [new Set(nameKey(r.team).split(" ").filter(Boolean)), r.short]);
  const cache = new Map();
  const rename = (name) => {
    if (cache.has(name)) return cache.get(name);
    let short = byKey.get(nameKey(name));
    if (!short) {
      // Feeds pad names ("Rayo Vallecano de Madrid"), so fall back to the club
      // sharing the most name tokens — needing two, and an outright winner.
      const mine = nameKey(name).split(" ").filter(Boolean);
      let best = null, most = 1, tied = false;
      for (const [tokens, candidate] of byTokens) {
        const hits = mine.reduce((n, t) => n + (tokens.has(t) ? 1 : 0), 0);
        if (hits > most) { best = candidate; most = hits; tied = false; }
        else if (hits === most && hits > 1) tied = true;
      }
      short = best && !tied ? best : shortName(name);
    }
    cache.set(name, short);
    return short;
  };
  const out = {};
  for (const [club, list] of Object.entries(fixtures)) {
    const sorted = [...list].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    const tuples = sorted.map((t) => [t[0], t[1], t[2], rename(t[3]), t[4], t[5], t[6]]);
    tuples.forEach((t, i) => { if (t[0] == null) t[0] = i + 1; });
    out[rename(club)] = tuples;
  }
  return out;
}

// openfootball publishes real matchday numbers but enters scores about a week
// late, so fill any gaps from ESPN, which settles results within the hour.
function mergeResults(base, fresh) {
  const sameWeek = (a, b) => {
    const x = Date.parse(a + "T12:00:00Z"), y = Date.parse(b + "T12:00:00Z");
    return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 3 * 864e5;
  };
  let filled = 0;
  for (const [club, list] of Object.entries(base)) {
    const other = fresh[club];
    if (!other) continue;
    for (const t of list) {
      if (t[5] != null) continue;
      const hit = other.find(
        (o) => o[3] === t[3] && o[4] === t[4] && o[5] != null && t[1] && o[1] && sameWeek(o[1], t[1])
      );
      if (hit) { t[5] = hit[5]; t[6] = hit[6]; filled++; }
    }
  }
  return filled;
}

async function build() {
  const comps = {};
  for (const [key, cfg] of Object.entries(COMPS)) {
    let result = null;
    let source = null;

    try {
      const espn = await getJSON(
        `https://site.api.espn.com/apis/v2/sports/soccer/${cfg.espn}/standings?season=${startYear}`
      );
      result = parseESPN(espn);
      if (result) source = "espn";
    } catch (e) {
      console.error(`[${key}] espn failed: ${e.message}`);
    }

    let ofTable = null;
    let ofData = null;
    if (cfg.of) {
      try {
        ofData = await getJSON(
          `https://raw.githubusercontent.com/openfootball/football.json/master/${cfg.of}`
        );
        ofTable = computeFromOpenfootball(ofData);
      } catch (e) {
        console.error(`[${key}] openfootball failed: ${e.message}`);
      }
    }

    if (!result && ofTable && ofTable.rows.length) {
      result = ofTable;
      source = "openfootball";
    } else if (result && ofTable) {
      // ESPN standings don't carry recent form; borrow it from openfootball.
      const formByKey = new Map(ofTable.rows.map((r) => [nameKey(r.team), r.form]));
      for (const r of result.rows) r.form = formByKey.get(nameKey(r.team)) ?? r.form;
    }

    if (result && result.rows.some((r) => (r.p ?? 0) > 0)) {
      const openfootball = ofData ? alignFixtures(fixturesFromOpenfootball(ofData), result.rows) : {};
      const espn = alignFixtures(await fixturesFromESPN(cfg.espn, startYear), result.rows);
      let fixtures = espn;
      if (Object.keys(openfootball).length) {
        const filled = mergeResults(openfootball, espn);
        console.error(`[${key}] ${filled} result(s) filled in from ESPN`);
        fixtures = openfootball;
      }
      const noFixtures = result.rows.filter((r) => !fixtures[r.short]).map((r) => r.short);
      if (noFixtures.length) console.error(`[${key}] no fixtures for: ${noFixtures.join(", ")}`);
      comps[key] = {
        name: cfg.name,
        source,
        matchday: result.matchday,
        rows: result.rows,
        fixtures,
      };
      console.error(`[${key}] fixtures for ${Object.keys(fixtures).length} clubs`);
    } else {
      comps[key] = { name: cfg.name, notStarted: true };
    }
    console.error(`[${key}] source=${comps[key].notStarted ? "none (not started)" : source} rows=${result?.rows?.length ?? 0}`);
  }

  const out = {
    generated: new Date().toISOString(),
    season: seasonLabel,
    comps,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
  console.error(`wrote ${OUT}`);
}

await build();
