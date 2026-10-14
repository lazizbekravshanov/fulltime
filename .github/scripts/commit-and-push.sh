#!/usr/bin/env bash
# Commit the named files, if they changed, and get them onto main.
#
# Two jobs write to this branch on overlapping schedules, so a push can lose a
# race it did nothing wrong in. Two earlier attempts at handling that both went
# wrong in instructive ways, and this is written against both:
#
#   * Backing off for a fixed 4, 8, 12, 16 seconds is worse than it looks. Two
#     runners that collide once then sleep for identical periods collide again,
#     in step. The wait is random here, so they drift apart.
#
#   * More importantly: on 2026-10-14 both jobs reported failure at this step
#     while their commits are sitting on main. Whatever git reported, the work
#     had landed. So this no longer decides by what `git push` returns — it
#     checks whether the files actually match origin, which is the thing we
#     care about, and is true or false regardless of how the push reported.
#
# Usage: commit-and-push.sh "<commit message>" <file> [file...]
set -u

msg="$1"; shift
files=("$@")

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -- "${files[@]}"

if git diff --cached --quiet; then
  echo "No changes."
  exit 0
fi
git commit -m "$msg"

# Is what we just committed already what origin holds for these files?
landed() {
  git fetch -q origin main 2>/dev/null || return 1
  git diff --quiet HEAD origin/main -- "${files[@]}" 2>/dev/null
}

for attempt in $(seq 1 8); do
  if git push; then
    echo "pushed on attempt $attempt"
    exit 0
  fi
  code=$?
  echo "git push exited $code on attempt $attempt"
  if landed; then
    echo "...but these files already match origin/main, so the work is in. Done."
    exit 0
  fi
  echo "not on origin yet; taking what landed and trying again"
  # The two jobs touch different files, so there is never a conflict to resolve.
  # If one somehow appears, abandon the rebase and keep our commit for the next
  # attempt rather than throwing a good refresh away.
  git rebase origin/main || git rebase --abort || true
  sleep $(( (RANDOM % 9) + 2 ))
done

echo "could not get these files onto main after 8 attempts:"
git --no-pager log --oneline -1
git --no-pager diff --stat HEAD origin/main -- "${files[@]}" || true
exit 1
