# Starfinder Character Bot Phase 5 Specification

**Status:** Sketch — not actionable  
**Date:** 2026-10-10  
**Source of truth:** Not yet. Until accepted, the latest accepted phase spec remains the governing spec.  
**Change control:** While this spec is a Sketch, it may be edited freely. Once accepted, do not revise it unless a human explicitly requests a spec update.

> **Gate:** This is a scope sketch only. It must be fleshed out into a full phase spec and explicitly accepted by the repository owner before any implementation, planning of code changes, or code modification is based on it. Agents must not act on this document while its status is **Sketch**.

---

## Theme

Let Discord users register themselves to a character, so a "me" shortcut can target that character in later query commands.

## Goals

- A user can register to a character ID. Registration only defines what "me" means for that user; it grants no special rights.
- Registration is non-exclusive: multiple users may register to the same character.
- Registering to a character that is not tracked adds it to the tracked roster, following the existing add behavior.
- Registrations are stored in the dashboard metadata and recovered on restart, like the tracked roster.
- Existing dashboard posts written before this phase must still be recognized after the upgrade.

## Out Of Scope

- Query commands (Phase 6). This phase only establishes registration.
- Permissions or roles beyond what exists today.

## Depends On

- Nothing external. Does not require the JSON endpoint and may be fleshed out before Phase 4 is complete.

## Open Questions To Resolve When Fleshing Out

- Command names and arguments for registering, unregistering, and viewing one's registration.
- Whether registration is per channel (matching current per-channel state) or per guild.
- What happens to registrations when a character is removed or the roster is cleared.
- Whether a user may change or clear another user's registration.
- Metadata format and versioning, and the practical limit imposed by Discord's message length.
