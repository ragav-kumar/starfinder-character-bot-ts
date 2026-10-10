# Starfinder Character Bot Phase 4 Specification

**Status:** Sketch — not actionable  
**Date:** 2026-10-10  
**Source of truth:** Not yet. Until accepted, `docs/phase-3-spec.md` remains the governing spec.  
**Change control:** Do not revise this specification unless a human explicitly requests a spec update.

> **Gate:** This is a scope sketch only. It must be fleshed out into a full phase spec and explicitly accepted by the repository owner before any implementation, planning of code changes, or code modification is based on it. Agents must not act on this document while its status is **Sketch**.

---

## Theme

Replace HTML scraping of Joe's Corner character-sheet pages with the per-character JSON player-data endpoint.

## Goals

- Fetch character data from the JSON endpoint (one URL per character, unauthenticated) instead of scraping `Character-sheet.php`.
- Keep the dashboard card's displayed content and behavior unchanged from Phase 3.
- Retain each character's full JSON data model in working state so later phases can use data beyond what the card shows.
- Tolerate schema drift: missing or unexpected fields must not fail a whole character; card fields fall back to `Unavailable` as today.
- Reject character IDs the endpoint reports as nonexistent, instead of tracking a placeholder character.
- Reconcile known drift between docs and code (see "Known Discrepancies" in `CLAUDE.md`) as part of this phase's documentation updates.

## Out Of Scope

- New commands or changes to acknowledgements.
- Card or template changes.
- Displaying notes data (bio, images, etc.) or any field not already on the card.

## Depends On

- The JSON endpoint being live, so the spec can be written against its real shape.

## Open Questions To Resolve When Fleshing Out

- Endpoint URL form, and whether it derives from `STARFINDER_SITE_BASE_URL` or needs a new setting.
- Whether the JSON provides computed totals (initiative, AC, saves) or only components.
- How the equipped weapon, conditions, and classes are represented.
- How a nonexistent character is signalled.
- Whether HTML scraping is removed or kept as a fallback.
