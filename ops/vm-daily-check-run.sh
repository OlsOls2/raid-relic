#!/bin/sh
# Parent-reviewed operator wrapper template; not installed by source author.
set -eu
umask 077
check_day=$(date -u +%Y-%m-%d)
[ "$check_day" \< "2026-10-26" ] && exit 0
[ "$check_day" \< "2026-11-03" ] || exit 0
: "${RAID_RELIC_CHECKOUT:?Operator must set reviewed checkout path}"
check_dir="$HOME/.raid-relic-daily-check"
mkdir -p "$check_dir"
exec 9>"$check_dir/lock"
flock -n 9 || exit 0
[ "$(cat "$check_dir/lastdate" 2>/dev/null || true)" = "$check_day" ] && exit 0
printf '%s\n' "$check_day" >"$check_dir/lastdate"
node "$RAID_RELIC_CHECKOUT/ops/vm-daily-check.mjs" --once >>"$check_dir/log" 2>&1
