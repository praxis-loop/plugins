#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
installed=0

if command -v claude >/dev/null 2>&1; then
  claude plugin marketplace add "$REPO_ROOT"
  echo "Registered Claude marketplace: praxis-plugins"
  installed=1
else
  echo "Claude Code not found; skipped."
fi

if command -v codex >/dev/null 2>&1 && codex help plugin >/dev/null 2>&1; then
  codex plugin marketplace add "$REPO_ROOT"
  echo "Registered Codex marketplace: praxis-plugins"
  installed=1
elif command -v codex >/dev/null 2>&1; then
  echo "Codex is installed, but this CLI version has no plugin command; use the Codex desktop plugin page/deeplink."
else
  echo "Codex not found; skipped."
fi

if [ "$installed" -eq 0 ]; then
  echo "Neither Claude Code nor Codex was found." >&2
  exit 1
fi

echo "Marketplace registration complete. Install Ponytail from the platform plugin UI/CLI when ready."
