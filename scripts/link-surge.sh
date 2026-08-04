#!/usr/bin/env bash
# Symlink the generated config directory into Surge's profile directory, so
# Surge Mac loads the profiles straight out of this repo.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILES="${SURGE_PROFILES_DIR:-$HOME/Library/Application Support/Surge/Profiles}"

usage() {
  cat <<'USAGE'
link-surge — link the generated config directory into Surge's profiles

Usage
  pnpm link:surge                 link .conf
  pnpm link:surge <dir>           link another directory
  ./scripts/link-surge.sh [dir]

Options
  -h, --help    show this help

Environment
  SURGE_CONF_DIR       directory to link      (default: .conf)
  SURGE_PROFILES_DIR   Surge profiles folder
                       (default: ~/Library/Application Support/Surge/Profiles)
  SURGE_LINK_NAME      name of the link       (default: the repo folder name)
USAGE
}

for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
  esac
done

CONF_ARG="${1:-${SURGE_CONF_DIR:-$SRC/.conf}}"
CONF="$(cd "$(dirname "$CONF_ARG")" 2>/dev/null && pwd)/$(basename "$CONF_ARG")" || CONF="$CONF_ARG"
LINK_NAME="${SURGE_LINK_NAME:-$(basename "$SRC")}"
LINK="$PROFILES/$LINK_NAME"

if [ ! -d "$CONF" ]; then
  echo "error: $CONF does not exist — run 'pnpm gen' first" >&2
  exit 1
fi

# A directory with no profile in it is almost certainly a mistake.
shopt -s nullglob
profiles=("$CONF"/*.conf)
shopt -u nullglob
if [ ${#profiles[@]} -eq 0 ]; then
  echo "error: no *.conf profile in $CONF — run 'pnpm gen' first" >&2
  exit 1
fi

if [ ! -d "$PROFILES" ]; then
  echo "error: Surge profiles folder not found:" >&2
  echo "  $PROFILES" >&2
  echo "Is Surge installed? Override with SURGE_PROFILES_DIR." >&2
  exit 1
fi

# Replace our own symlink freely, but never delete a real file or directory
# someone put there.
if [ -L "$LINK" ]; then
  current="$(readlink "$LINK")"
  if [ "$current" = "$CONF" ]; then
    echo "already linked: $LINK -> $CONF"
    exit 0
  fi
  echo "replacing existing link (was -> $current)"
  rm "$LINK"
elif [ -e "$LINK" ]; then
  echo "error: $LINK exists and is not a symlink; refusing to replace it" >&2
  exit 1
fi

ln -s "$CONF" "$LINK"
echo "linked: $LINK -> $CONF"

# The profiles reference Shared.ini and Rules/ relative to their own directory,
# so confirm those resolve through the link rather than just the link itself.
missing=0
for f in "${profiles[@]}"; do
  echo "  profile: $(basename "$f")"
done
for dep in Shared.ini Rules; do
  [ -e "$CONF/$dep" ] || { echo "  warning: $dep missing from $CONF" >&2; missing=1; }
done
[ "$missing" -eq 0 ] && echo "  Shared.ini and Rules/ resolve through the link"

echo
echo "In Surge: pick $LINK_NAME -> the profile you want."
