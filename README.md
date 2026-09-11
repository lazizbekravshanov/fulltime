# FULLTIME

Live league tables for the **Premier League**, **La Liga** and the **UEFA
Champions League**, plus the full season fixture list for every club.

Live: https://lazizbekravshanov.github.io/fulltime/

- Current standings with form, goal difference and qualification zones.
- Click any club for its whole season: every match in date order, grouped by
  month, with results, home/away and kick-off times for what's still to come.
- A 2025/26 archive view with the final tables from last season.

## It updates itself

A scheduled GitHub Action runs every 6 hours, pulls current standings and
fixtures, and commits `data.json`. The page loads the newest `data.json` at
view time, so there is nothing to redeploy and nothing to do by hand. The
season rolls over automatically each August.

Sources: ESPN's public feed for standings, crests and Champions League
fixtures; [openfootball](https://github.com/openfootball/football.json) open
data for domestic fixtures and matchday numbers. Where the two disagree on a
club's name, fixtures are re-keyed onto the name the table shows.

## Files

- `index.html` — the entire site (vanilla HTML/CSS/JS, no build step)
- `data.json` — standings + fixtures snapshot, committed by the Action
- `scripts/update-standings.mjs` — the updater (Node 18+, zero dependencies)
- `vercel.json` — config if you'd rather host it on Vercel

Fixture tuples are `[matchday, date, time, opponent, home, goalsFor,
goalsAgainst]`; a trailing `Z` on the time marks a UTC kick-off, and null
goals mean the match hasn't been played.

## Run it locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
node scripts/update-standings.mjs   # refresh data.json by hand
```
