# FULLTIME

League tables for the **Premier League**, **La Liga** and the **UEFA Champions
League** — standings, every club's full season, and round-by-round results.

Live: https://lazizbekravshanov.github.io/fulltime/

## What it does

**Tables.** Overall standings come straight from the competition's own table,
so the tiebreaks are the real ones. Home, Away, Last 5 and Projected are
recomputed in the browser from the fixture list, and each row marks how far the
club has moved against the real table. Projected carries points-per-game across
every remaining fixture and shows the current total beside it.

**Next five.** Every row carries its next five opponents as crests, underlined
by how high that opponent currently sits — a fixture-difficulty read at a
glance. Faded means away.

**Matchdays.** Every match in a round, league-wide, with prev/next and a jump
back to the current round.

**Match pages.** Tap any match for the scoreline, every goal with its scorer and
minute (penalties and own goals marked), live text commentary while it is being
played, and the head-to-head record between the two clubs. Scorers come from the
hourly snapshot and are always there; commentary is fetched from ESPN the moment
you open a match and refreshes every 45 seconds while it is in play.

**Clubs.** Tap any club for its whole season: every match in date order grouped
by month, results and kick-offs, home/away splits, form, and a season-shape
chart of its position after each matchday. Clubs in two competitions can merge
both schedules into one chronological season. Any club's fixtures export as an
`.ics` calendar, generated in the browser.

**Season records.** Longest current unbeaten run, longest winless run, biggest
win and most clean sheets, per competition.

**Top performers.** Goals, assists, shots on target, accurate passes, saves and
yellow cards — the top eight in each, per competition, switchable in place.

**Live scores.** Matches in play carry a running score and a LIVE badge, on the
table, the matchday list and the club's season.

**Yours.** Star a club and it pins above its table and becomes the landing
view. Search filters as you type (`/` focuses it, Enter opens the top hit).
Light and dark both first-class, following the system preference until you
choose. Installable to a phone home screen — but no service worker, because
stale standings are worse than no offline mode.

Kick-offs are stored in UTC and rendered in your own time zone, which the page
names so you know what you're reading.

## It updates itself

Two layers, so the page is never showing yesterday's table.

A browser cannot read ESPN directly. It answers `curl` with
`Access-Control-Allow-Origin: *` but sends no such header to a real `fetch`, so
every cross-origin request from the page is blocked. Everything is therefore
pulled by scheduled jobs, which have no such restriction, and committed here.

**Every five minutes** `update-live.mjs` writes `live.json`: the current table,
today's scores, goal scorers, and text commentary for the matches in play or
just finished. It is one standings call and one scoreboard call per competition,
so it stays quick. The page fetches it after first paint, applies it on top of
the snapshot — a finished match is written into the fixture list, so the splits,
records and season-shape chart all move with it — and polls it once a minute
while a match is in play.

**Every hour** `update-standings.mjs` writes `data.json`: the full season of
fixtures, the archive, competition leaders and crests. That is what gives the
page its instant first paint and something to show when nothing else can be
reached.

Both files are asked for with a per-minute token, because GitHub caches them for
ten minutes. The season rolls over automatically each August.

Sources: ESPN's public feed for standings, crests, kick-off instants, goal
scorers, commentary, competition leaders and Champions League fixtures;
[openfootball](https://github.com/openfootball/football.json) open data for
domestic fixtures and matchday numbers. Where the two disagree on a club's
name, fixtures are re-keyed onto the name the table shows; where they disagree
on a result, ESPN wins, because openfootball posts scores about a week late.

## Files

- `index.html` — the entire site (vanilla HTML/CSS/JS, no build step)
- `data.json` — the hourly snapshot: standings, fixtures, leaders, archive
- `live.json` — the five-minute file: table, today's scores, scorers, commentary
- `scripts/update-standings.mjs` — the hourly updater (Node 18+, zero dependencies)
- `scripts/update-live.mjs` — the five-minute updater, sharing its helpers
- `.github/scripts/live-check.mjs` — drives the published site in a real browser
- `manifest.webmanifest`, `icon*.png`, `icon.svg` — home-screen install
- `vercel.json` — config if you'd rather host it on Vercel

Fixture tuples are `[matchday, date, time, opponent, home, goalsFor,
goalsAgainst, eventId]`; the time is UTC with a trailing `Z`, null goals mean the
match hasn't been played, and the event id keys into `comps.<league>.events`,
where each match's goals are `[minute, scorer, home?1:0, kind]` with kind `""`,
`"p"` for a penalty or `"o"` for an own goal.

## Run it locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
node scripts/update-standings.mjs   # refresh data.json by hand
node scripts/update-live.mjs        # refresh live.json by hand
node scripts/scorers.test.cjs       # unit-test the scorer parsing
```
