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

**Live scores.** If a match is kicking off around now, the page fetches that
day's scoreboard directly and overlays live scores while it plays. Entirely
opportunistic: any failure is silent and the committed snapshot stands.

**Yours.** Star a club and it pins above its table and becomes the landing
view. Search filters as you type (`/` focuses it, Enter opens the top hit).
Light and dark both first-class, following the system preference until you
choose. Installable to a phone home screen — but no service worker, because
stale standings are worse than no offline mode.

Kick-offs are stored in UTC and rendered in your own time zone, which the page
names so you know what you're reading.

## It updates itself

A scheduled GitHub Action runs every hour, pulls current standings and
fixtures, and commits `data.json`. The page loads the newest `data.json` at
view time, so there is nothing to redeploy and nothing to do by hand. The
season rolls over automatically each August. If the snapshot ever goes more
than a day stale, the page recomputes the domestic tables in the browser from
open data rather than showing old numbers.

Sources: ESPN's public feed for standings, crests, kick-off instants, goal
scorers, commentary, competition leaders and Champions League fixtures;
[openfootball](https://github.com/openfootball/football.json) open data for
domestic fixtures and matchday numbers. Where the two disagree on a club's
name, fixtures are re-keyed onto the name the table shows; where they disagree
on a result, ESPN wins, because openfootball posts scores about a week late.

## Files

- `index.html` — the entire site (vanilla HTML/CSS/JS, no build step)
- `data.json` — standings, fixtures and leaders snapshot, committed by the Action
- `scripts/update-standings.mjs` — the updater (Node 18+, zero dependencies)
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
```
