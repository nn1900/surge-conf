#!/usr/bin/env bash
# Publish the profiles and rule sets into Surge's iCloud Drive container so
# Surge iOS can pick them up. Extra args are passed through to rsync
# (e.g. --dry-run).
#
# Everything goes into a subdirectory (Surge iOS 4.0.2+ can choose a profile
# from one), which keeps the container root free of our files and lets the
# whole tree be mirrored with --delete.
#
# The published tree is flattened: Surge iOS resolves only one directory level
# for local RULE-SET paths, so Rules/Media/X.list never loads there, while
# Surge Mac handles the nesting fine. The repo keeps its tree untouched and
# the flattening happens here, in a staging copy.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Profiles are generated, not tracked; gen-conf writes them here.
CONF="${SURGE_CONF_DIR:-$SRC/.conf}"
BASE="${SURGE_ICLOUD_DIR:-$HOME/Library/Mobile Documents/iCloud~com~nssurge~inc/Documents}"
DEST="$BASE/${SURGE_ICLOUD_SUBDIR:-surge-conf}"

usage() {
  cat <<'USAGE'
sync-icloud — publish the iOS profile into Surge's iCloud Drive container

Usage
  npm run sync                   publish
  npm run sync:dry               preview with --dry-run --itemize-changes
  ./scripts/sync-icloud.sh [rsync options...]

  Publishes what gen-conf wrote to .conf (override with SURGE_CONF_DIR).

Options
  --with-macos   also publish Surge-Macos.conf
  --no-macos     do not (default)
  -h, --help     show this help
  anything else is passed straight through to rsync, e.g. --dry-run

Environment
  SURGE_CONF_DIR     rendered profiles   (default: .conf)
  SURGE_ICLOUD_DIR   container path
  SURGE_ICLOUD_SUBDIR  subdirectory within it   (default: surge-conf)
  SURGE_SYNC_MACOS   set to 1 to publish Surge-Macos.conf by default

USAGE
}

# Our own flags are consumed here; everything else goes on to rsync.
RSYNC_ARGS=()
WITH_MACOS="${SURGE_SYNC_MACOS:-0}"
for arg in "$@"; do
  case "$arg" in
    -h|--help)             usage; exit 0 ;;
    --with-macos|--macos)  WITH_MACOS=1 ;;
    --no-macos)            WITH_MACOS=0 ;;
    *)                     RSYNC_ARGS+=("$arg") ;;
  esac
done

if [ ! -d "$BASE" ]; then
  echo "error: Surge iCloud folder not found:" >&2
  echo "  $BASE" >&2
  echo "Turn on Profile Sync -> iCloud Drive in Surge, or set SURGE_ICLOUD_DIR." >&2
  exit 1
fi

# Surge-Macos.conf is left out by default: it carries macOS-only keys
# (http-listen, ipv6-vif) and would just clutter the iOS profile list. Pass
# --with-macos when you want the Mac to read its profile from iCloud too.
SOURCES=("$CONF/Shared.ini" "$CONF/Surge-iOS.conf" "$SRC/Rules")
if [ "$WITH_MACOS" = "1" ]; then
  SOURCES+=("$CONF/Surge-Macos.conf")
fi

for s in "${SOURCES[@]}"; do
  [ -e "$s" ] || { echo "error: $s not found — run 'npm run gen' first" >&2; exit 1; }
done

# Stage the exact tree we want, then mirror it. Handing rsync a directory
# rather than a list of files is what makes --delete prune the destination
# root as well; named file sources only prune inside transferred subdirs.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -RL "${SOURCES[@]}" "$STAGE/"

# Rules/<group>/X.list -> Rules/<group>_X.list
shopt -s nullglob
for dir in "$STAGE"/Rules/*/; do
  group="$(basename "$dir")"
  for f in "$dir"*; do
    target="$STAGE/Rules/${group}_$(basename "$f")"
    if [ -e "$target" ]; then
      echo "error: flattening would overwrite $(basename "$target")" >&2
      exit 1
    fi
    mv "$f" "$target"
  done
  rmdir "$dir"
done
shopt -u nullglob

# Point the rule-set references at the flattened names.
for profile in "$STAGE"/*.ini "$STAGE"/*.conf; do
  [ -f "$profile" ] || continue
  sed -E 's#(RULE-SET,Rules/)([^/,]+)/#\1\2_#g' "$profile" > "$profile.tmp"
  mv "$profile.tmp" "$profile"
done

# Refuse to publish a tree whose rule sets don't all resolve — a broken profile
# on the phone is much harder to debug than a failed sync here.
missing=0
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  if [ ! -f "$STAGE/$rel" ]; then
    echo "error: rule set referenced but not staged: $rel" >&2
    missing=1
  fi
done < <(grep -ho '^RULE-SET,[^,]*' "$STAGE"/*.ini "$STAGE"/*.conf 2>/dev/null |
         cut -d, -f2 | grep '/' | grep -v '://' | sort -u)
[ "$missing" -eq 0 ] || exit 1

# A dry run should leave nothing behind, not even an empty destination.
DRY=0
for a in ${RSYNC_ARGS[@]+"${RSYNC_ARGS[@]}"}; do
  case "$a" in -n|--dry-run) DRY=1 ;; esac
done
[ "$DRY" = "1" ] || mkdir -p "$DEST"

# --exclude '.*' keeps .DS_Store out, and because excluded paths are also
# protected from --delete, it preserves the hidden .iosinterface files Surge
# writes next to a profile to remember its policy selections.
rsync -rlt --no-perms --no-owner --no-group \
  --delete --exclude '.*' \
  ${RSYNC_ARGS[@]+"${RSYNC_ARGS[@]}"} \
  "$STAGE/" "$DEST/"

echo "synced -> $DEST${WITH_MACOS:+$([ "$WITH_MACOS" = 1 ] && echo '  (including Surge-Macos.conf)')}"
