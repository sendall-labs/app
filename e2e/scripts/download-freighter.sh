#!/usr/bin/env bash
# Downloads and unpacks the latest Freighter wallet extension release for use
# in Playwright e2e tests (see e2e/fixtures/wallet.ts). Not vendored in the
# repo — this always pulls the current published build.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
DEST="extensions/freighter"

if [ -f "$DEST/manifest.json" ]; then
  echo "Freighter extension already present at e2e/$DEST"
  exit 0
fi

mkdir -p extensions
tmp_zip="$(mktemp -t freighter-XXXXXX.zip)"
trap 'rm -f "$tmp_zip"' EXIT

tag="$(gh api repos/stellar/freighter/releases/latest --jq '.tag_name')"
asset="build-${tag}.zip"
echo "Downloading Freighter ${tag} (${asset})…"
gh release download "$tag" --repo stellar/freighter --pattern "$asset" --output "$tmp_zip" --clobber

rm -rf "$DEST"
mkdir -p "$DEST"
unzip -q "$tmp_zip" -d "$DEST"

test -f "$DEST/manifest.json"
echo "Freighter extension ready at e2e/$DEST"
