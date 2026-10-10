# Starfinder Character Bot Phase 7 Specification

**Status:** Sketch — not actionable  
**Date:** 2026-10-10  
**Source of truth:** Not yet. Until accepted, the latest accepted phase spec remains the governing spec.  
**Change control:** Do not revise this specification unless a human explicitly requests a spec update.

> **Gate:** This is a scope sketch only. It must be fleshed out into a full phase spec and explicitly accepted by the repository owner before any implementation, planning of code changes, or code modification is based on it. Agents must not act on this document while its status is **Sketch**.

---

## Theme

Show each character's portrait on their dashboard card.

## Goals

- Embed the character's portrait, sourced from the JSON endpoint's notes data, in the card.
- Once this spec is accepted, it is the explicit template redesign request that `AGENTS.md` requires before `templates/character-card.html` may change. That permission is limited to this phase.
- A missing or unloadable portrait shows a fallback and does not mark the character stale or break the dashboard.
- Polling must not re-download unchanged portraits on every cycle.

## Out Of Scope

- Other card redesign beyond accommodating the portrait.
- User-selectable themes or layouts.

## Depends On

- Phase 4 (JSON data source), and the endpoint exposing portrait data.

## Open Questions To Resolve When Fleshing Out

- Where the portrait comes from in the JSON, and its image formats and sizes.
- Download limits (timeout, size, content type) and caching approach.
- New card dimensions and their effect on the composite dashboard layout.
- Fallback appearance when no portrait is available.
