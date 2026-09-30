# 2026-09-18 — Mandatory context-doc rule in agent instructions

Sources: `AGENTS.md`, `CLAUDE.md`.

## What changed

- Added `## Context docs (mandatory)` to `AGENTS.md` and `CLAUDE.md`: after any request that modifies files, append `docs/context/YYYY-MM-DD-slug.md` (UTC date, kebab slug) with what/why/files/verify, plus the `docs/context/README.md` index row. Never rewrite past dated files; supersede with a new file plus pointer. Docs-only/read-only tasks skip.

## Why

- Standing agreement: every file-modifying task leaves a traceable dated note, so future agents get context without re-deriving it.

## Files touched

- `AGENTS.md` (new section before Reference docs)
- `CLAUDE.md` (new section before Git conventions)

## Verify

- Read both sections; confirm `docs/context/README.md` index lists this file.
