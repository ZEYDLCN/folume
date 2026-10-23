#!/usr/bin/env bash
# Puts the backend together with the Space's Dockerfile and README and pushes it to a Hugging Face Space.
#
#   deploy/huggingface/publish.sh <hf-username>/<space-name> [docker|gradio]
#
# `docker` (the default) needs a Space with the Docker SDK, which Hugging Face now lists as a paid feature for new
# accounts. `gradio` makes a Gradio-type Space that only runs the API (app.py); pick it when Docker is not offered.
#
# Git asks for a user name (your Hugging Face user) and a password: paste an access token with write access
# (https://huggingface.co/settings/tokens). Nothing of this repository's history is sent, only the files the server needs.
set -euo pipefail

SPACE="${1:?usage: publish.sh <hf-username>/<space-name> [docker|gradio]}"
KIND="${2:-docker}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cp "$ROOT/backend/pyproject.toml" "$WORK/"
cp -R "$ROOT/backend/src" "$WORK/src"
case "$KIND" in
  docker) cp "$HERE/Dockerfile" "$HERE/README.md" "$WORK/" ;;
  gradio) cp "$HERE/gradio/README.md" "$HERE/gradio/app.py" "$HERE/gradio/requirements.txt" "$WORK/" ;;
  *) echo "second argument must be docker or gradio" >&2; exit 2 ;;
esac
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
