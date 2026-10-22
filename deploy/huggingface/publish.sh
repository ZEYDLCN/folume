#!/usr/bin/env bash
# Puts the backend together with the Space's Dockerfile and README and pushes it to a Hugging Face Space.
#
#   deploy/huggingface/publish.sh <hf-username>/<space-name>
#
# Git asks for a user name (your Hugging Face user) and a password: paste an access token with write access
# (https://huggingface.co/settings/tokens). Nothing of this repository's history is sent, only the files the server needs.
set -euo pipefail

SPACE="${1:?usage: publish.sh <hf-username>/<space-name>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cp "$ROOT/backend/pyproject.toml" "$WORK/"
cp -R "$ROOT/backend/src" "$WORK/src"
cp "$HERE/Dockerfile" "$HERE/README.md" "$WORK/"
find "$WORK" -name __pycache__ -type d -prune -exec rm -rf {} +
find "$WORK" -name '*.egg-info' -type d -prune -exec rm -rf {} +

cd "$WORK"
git init -q -b main
git add -A
git -c user.name="${GIT_AUTHOR_NAME:-Folume deploy}" -c user.email="${GIT_AUTHOR_EMAIL:-deploy@localhost}" commit -q -m "Folume API"
git push --force "https://huggingface.co/spaces/${SPACE}" main
echo
echo "Pushed. The Space builds now (a few minutes): https://huggingface.co/spaces/${SPACE}"
HOST="$(echo "${SPACE//\//-}" | tr 'A-Z_.' 'a-z--')"
echo "When it runs, open https://${HOST}.hf.space/v1/health"
