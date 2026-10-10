# Starfinder Character Bot Phase 6 Specification

**Status:** Sketch — not actionable  
**Date:** 2026-10-10  
**Source of truth:** Not yet. Until accepted, the latest accepted phase spec remains the governing spec.  
**Change control:** While this spec is a Sketch, it may be edited freely. Once accepted, do not revise it unless a human explicitly requests a spec update.

> **Gate:** This is a scope sketch only. It must be fleshed out into a full phase spec and explicitly accepted by the repository owner before any implementation, planning of code changes, or code modification is based on it. Agents must not act on this document while its status is **Sketch**.

---

## Theme

Let users query any character data exposed by the JSON endpoint from Discord.

## Goals

- Any data available in a character's JSON can be queried, not only the fields shown on the dashboard card.
- Three query targets (names illustrative only):
  - a specific character, e.g. `/character 110 perception`
  - the user's registered character, e.g. `/me acrobatics`
  - the whole tracked roster, e.g. `/party stealth`
- Answers come from the most recent poll or refresh; queries do not trigger extra fetches.
- Field selection is generic, so data the endpoint adds later becomes queryable without code changes.

## Out Of Scope

- Changes to the dashboard card.
- Editing character data; queries are read-only.

## Depends On

- Phase 4 (JSON data retained in working state).
- Phase 5 (registration, for the "me" target).

## Open Questions To Resolve When Fleshing Out

- Command names and structure.
- How fields are addressed: raw JSON paths, friendly aliases, indexes (e.g. spell level), and derived values (e.g. equipped weapon); use of Discord autocomplete.
- Whether "party" means the current channel's tracked roster.
- Whether untracked characters can be queried.
- Reply visibility (ephemeral or public) and handling of long values against Discord message limits.
