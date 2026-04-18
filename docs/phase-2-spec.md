# Starfinder Character Bot Phase 2 Specification

**Status:** Draft for next implementation phase  
**Date:** 2026-04-17  
**Source of truth:** This document defines the intended Phase 2 behavior. If this document disagrees with `docs/prototype-spec.md`, this Phase 2 spec takes priority. If a later numbered phase spec is added, the later phase spec takes priority over this one.  
**Change control:** Do not revise this specification unless a human explicitly requests a spec update.

**Historical note:** Phase 3 is now specified in `docs/phase-3-spec.md` and supersedes this document where they conflict. Preserve this file as the Phase 2 reference spec.

---

## 1. Purpose

Phase 2 replaces the Phase 1 text-message dashboard with an image-based dashboard while preserving the bot's core role:
- track one or more Starfinder characters hosted on Joe's Corner character-sheet pages
- refresh their displayed state on demand or by polling
- present the current tracked roster in Discord as a persistent dashboard

Each tracked character is still identified by the numeric `characterID` query parameter from the character-sheet URL:

```text
https://<site_url>?characterID=<numeric id>
```

---

## 2. Phase Scope

Phase 2 is still a prototype-oriented design, but it changes the dashboard contract in a major way.

### In scope
- A single persistent dashboard post per guild in the configured dashboard channel
- One rendered image per tracked character attached to that dashboard post
- Manual refresh and optional periodic polling that update the same dashboard post
- Dashboard recovery after bot restart by rediscovering the tagged dashboard post
- Rebuilding the tracked-character registry from metadata stored in the dashboard post
- Compact, readable visual panel rendering for the same character data shown in Phase 1

### Out of scope
- Multiple dashboards per guild
- Historical audit logs
- User-selectable dashboard themes or per-guild layout customization
- Rich persistence outside Discord for the core tracked-character registry
- Expanding character coverage beyond the fields already required by Phase 1 unless a later spec explicitly adds fields

---

## 3. Runtime Model

### 3.1 Guild scope
Behavior remains scoped per Discord server/guild.

Each guild has:
- one configured **bot channel** where commands are used and where the persistent dashboard post lives

### 3.2 Source of truth
For Phase 2, the authoritative tracked-character registry is the tagged dashboard post in the configured bot channel.

The bot may keep an in-memory working state while running, but after a restart it must be able to recover by:
1. locating the authoritative dashboard post in the configured dashboard channel
2. reading the tracked-character metadata from that post
3. reconstructing the tracked roster and dashboard target from that metadata

### 3.3 Working state
While running, the bot may keep in memory:
- the ordered tracked `characterID` list
- whether periodic tracking is enabled
- the polling interval in seconds
- the last successfully scraped snapshot for each character
- the dashboard message handle for the authoritative dashboard post

Only the tracked-character registry and dashboard targeting are required to survive restart, and they survive by recovery from the tagged dashboard post rather than from separate persistence.

---

## 4. Dashboard Post Contract

## 4.1 One-post model
Each guild has exactly one authoritative dashboard post in the configured bot channel.

That post must be the target for:
- initial dashboard creation
- add/remove/clear updates
- manual refresh updates
- automatic polling updates

Routine updates must edit this same post rather than create new persistent dashboard posts.

## 4.2 Required tagging and metadata
The dashboard post message body must contain a bot-readable metadata block at the top of the message.

The required block format is:

```text
[starfinder-character-bot dashboard v1]
guildId: <guild id>
trackedCharacterIds: <comma-separated numeric ids, or empty>
updatedAt: <UTC timestamp>
```

Rules:
- The first line must match exactly and serves as the dashboard marker.
- `guildId` must match the Discord guild that owns the dashboard.
- `trackedCharacterIds` is the authoritative ordered registry for the guild.
- `updatedAt` records when the dashboard post was last regenerated.
- Additional human-readable text may appear after a blank line below the metadata block and is ignored for recovery purposes.

## 4.3 Attachments
The dashboard post attachments must contain one image per tracked character.

Rules:
- attachment order must match the `trackedCharacterIds` order in the metadata block
- each image corresponds to exactly one tracked character
- routine updates replace the attachment set for the dashboard post so that the message body metadata and image list stay in sync

## 4.4 Recovery and conflict handling
On startup or whenever in-memory dashboard targeting is missing, the bot must inspect the configured bot channel for the authoritative tagged post.

Rules:
- If exactly one valid tagged dashboard post is found, use it.
- If no valid tagged dashboard post is found, the bot may create a new one the next time a command needs dashboard output.
- If multiple tagged posts are found, the bot must choose the most recently updated valid one and treat all others as non-authoritative.
- If a tagged post is malformed, has a mismatched `guildId`, or has invalid `trackedCharacterIds`, it must not be treated as authoritative.
- If recovery fails because there is no valid authoritative post, the bot must not guess tracked characters from attachments alone.

---

## 5. Commands

Phase 2 keeps the Phase 1 slash command set unless a later spec changes it.

Supported commands:
- `/characters add <characterIDs>`
- `/characters remove <characterID>`
- `/characters clear`
- `/characters list`
- `/characters refresh`
- `/characters tracking start [pollingPeriod]`
- `/characters tracking stop`

### Command compatibility rule
Unless explicitly overridden below, command acknowledgement rules and validation behavior remain the same as Phase 1.

### Phase 2 channel model
Phase 2 removes the Phase 1 distinction between configuration and dashboard channels.

Rules:
- all supported commands run in the configured bot channel
- the authoritative dashboard post also lives in that same configured bot channel
- if a command is used outside the configured bot channel, the bot should acknowledge that and direct the user to the correct channel

### Phase 2 dashboard effects
- `/characters add` updates the authoritative dashboard post metadata and attachments so the new character appears as a new image.
- `/characters remove` updates the authoritative dashboard post metadata and attachments so the removed character image disappears.
- `/characters clear` empties the tracked-character registry, stops polling, and updates the authoritative dashboard post to an empty-dashboard state rather than deleting the authoritative post entirely.
- `/characters refresh` refreshes all tracked characters once and edits the authoritative dashboard post in place.
- automatic polling edits the authoritative dashboard post in place.

### Empty-dashboard state
When zero characters are tracked, the authoritative dashboard post must remain present and tagged.

In this state:
- `trackedCharacterIds` is empty
- the post contains no character images
- the human-readable portion of the message should indicate that no characters are currently tracked

---

## 6. Dashboard Rendering

## 6.1 Image model
Each tracked character is rendered as a compact, readable status-panel image.

Historical note:
- Later implementation/spec work corrected the scraper model for conditions, character class, and equipped-weapon details.
- Use Phase 3 as the current source of truth for field semantics; this Phase 2 section is retained to describe the Phase 2 image-dashboard intent.

Each image must contain the same logical data required by Phase 1:
- **Name**
- **Initiative**
- **Health/Resolve section data**
  - current and total **HP**
  - current and total **Stamina**
  - current and total **Resolve**
- **Conditions**
- **EAC**
- **KAC**
- **Saving throws**
- **Attack bonuses**
- **Equipped weapon** information, including:
  - weapon name
  - ammo
  - damage type
  - range
  - damage

If a field cannot be extracted reliably, the image should show `Unavailable` rather than fail completely.

## 6.2 Layout goal
The image should present the data as a compact, readable status card rather than as a screenshot of raw markdown.

The spec intentionally leaves the rendering technology open. The implementation may choose any image-rendering approach that can reliably produce offline-testable panel images.

## 6.3 Stale state
If the bot cannot refresh a character during an expected update window, stale status must be visible in that character's image.

Rules:
- stale indication is required inside the affected character image
- stale indication in the dashboard message text is optional
- a later successful refresh clears the stale indicator for that character

---

## 7. Polling And Update Behavior

## 7.1 Refresh cycle
When the bot refreshes tracked characters, it should:
1. read the authoritative ordered `trackedCharacterIds` list
2. fetch each tracked character page
3. scrape the required fields
4. regenerate the per-character images
5. edit the authoritative dashboard post so that both metadata and attachments reflect the current tracked roster

## 7.2 Stable ordering
Dashboard image order should remain stable based on the order stored in `trackedCharacterIds`.

The bot must not reshuffle images on every refresh.

## 7.3 Attachment replacement behavior
For add, remove, clear, refresh, and polling updates, the dashboard post attachments should be replaced as a synchronized set rather than patched opportunistically one at a time.

This keeps:
- metadata ordering
- attachment ordering
- rendered content

in sync within a single authoritative dashboard edit.

## 7.4 Failure handling during update
If one or more character fetches fail during a refresh or poll:
- keep the previous successful image for that character if one exists
- mark that character's image as stale
- do not remove successfully tracked characters from `trackedCharacterIds` due only to refresh failure
- continue updating the authoritative post for other characters when possible

If the dashboard post is found but the attachment update fails:
- the bot must keep the existing authoritative post
- it must not create a replacement dashboard post as a fallback for routine refresh failure
- user-triggered operations should acknowledge that the dashboard update failed

---

## 8. Validation And Error Handling

### Invalid input
- Non-numeric `characterID` values are rejected.
- Duplicate IDs should return an `already tracked` acknowledgement.

### Unreachable or missing character pages
If the source page is unreachable, missing, or clearly invalid:
- do not add the character
- return a short error acknowledgement

### Missing dashboard post
If no valid authoritative dashboard post exists:
- the bot may create one when a dashboard-affecting command requires it
- the new post must immediately include the required metadata block

### Missing channel setup
If the required bot-channel configuration is missing, the bot should:
- acknowledge the command
- explain what is missing
- avoid silently failing

### Malformed dashboard metadata
If a tagged dashboard post exists but its metadata is malformed or incomplete:
- ignore it for recovery
- acknowledge the problem for user-triggered recovery-sensitive operations when practical
- prefer creating or re-establishing one clean authoritative post over trying to infer missing data

---

## 9. Command Reference Maintenance

A separate human-facing command reference must exist at `docs/command-reference.md`.

Rules:
- it is the living reference for operators who need to know what commands exist and how to use them
- it must be updated any time supported slash commands or their user-visible behavior change
- it does not override the numbered phase specs for product behavior
- when a command change is made, update both this spec and the command reference in the same change

---

## 10. Non-Goals For This Version

The following remain intentionally deferred or excluded:
- long-term persistence outside Discord for the tracked-character registry
- multiple dashboards per guild
- historical change logs
- a full theme/custom-layout system for panel images
- support for multiple rendering styles selected at runtime
