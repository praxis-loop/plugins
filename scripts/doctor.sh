#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Repository: $REPO_ROOT"
echo "Runtime: node $(node --version), npm $(npm --version)"

(cd "$REPO_ROOT" && npm test)
(cd "$REPO_ROOT" && node tools/pluginctl check --offline)

echo
echo "CLI availability:"
command -v claude >/dev/null 2>&1 && echo "  OK: Claude Code" || echo "  INFO: Claude Code not found"
if command -v codex >/dev/null 2>&1 && codex help plugin >/dev/null 2>&1; then
  echo "  OK: Codex with plugin command"
elif command -v codex >/dev/null 2>&1; then
  echo "  INFO: Codex found, but this version has no plugin command"
else
  echo "  INFO: Codex not found"
fi

echo
echo "Git sync status:"
if [ -n "$(git -C "$REPO_ROOT" status --short)" ]; then
  echo "  WARN: uncommitted working tree changes"
  git -C "$REPO_ROOT" status --short | sed 's/^/    /'
else
  echo "  OK: working tree clean"
fi

if upstream="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"; then
  read -r behind ahead < <(git -C "$REPO_ROOT" rev-list --left-right --count "$upstream...HEAD")
  [ "$ahead" -eq 0 ] && echo "  OK: no unpushed commits" || echo "  WARN: $ahead unpushed commit(s)"
  [ "$behind" -eq 0 ] && echo "  OK: no remote commits to pull" || echo "  WARN: $behind remote commit(s) to pull"
else
  echo "  WARN: current branch has no upstream"
fi
