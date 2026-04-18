# Starfinder Character Bot Command Reference

**Audience:** Human operators and testers  
**Purpose:** Living reference for the bot's current slash commands and their visible behavior  
**Maintenance rule:** Update this document any time supported commands, arguments, channel restrictions, acknowledgements, or dashboard side effects change.

---

## Overview

The bot currently exposes one slash-command group:

```text
/characters
```

Channel model:
- Phase 1: use the configured **configuration channel** for management commands and the configured **dashboard channel** for `/characters refresh`
- Phase 2 target: use one configured **bot channel** for all commands and for the tagged dashboard post

Dashboard model by phase:
- Phase 1: one persistent text panel message per tracked character
- Phase 2 target: one tagged dashboard message with one image per tracked character

If a numbered phase spec and this reference disagree, the later numbered phase spec wins. Use this document as the human-facing quick reference, not as the design authority.

---

## Commands

## `/characters add <characterIDs>`

Adds one or more character IDs to tracking.

Arguments:
- `characterIDs`: one or more numeric IDs separated by spaces

Example:

```text
/characters add 110 245 381
```

Behavior:
- processes each ID independently
- adds each valid, reachable character to the tracked roster
- reports duplicates without adding them again
- reports invalid or unreachable IDs as failures

Dashboard effect:
- Phase 1: creates one persistent panel message per newly tracked character
- Phase 2 target: updates the tagged dashboard post so a new image is present for each newly tracked character

Acknowledgement:
- concise per-ID summary, typically ephemeral when supported

## `/characters remove <characterID>`

Removes one tracked character.

Arguments:
- `characterID`: one numeric ID

Behavior:
- removes the character if it is currently tracked
- reports `Not tracked` if the ID is not in the roster

Dashboard effect:
- Phase 1: deletes that character's dashboard message
- Phase 2 target: updates the tagged dashboard post so that character's image is removed

Acknowledgement:
- short success or not-tracked message, typically ephemeral when supported

## `/characters clear`

Removes all tracked characters for the current guild.

Behavior:
- clears the tracked roster
- stops automatic tracking

Dashboard effect:
- Phase 1: deletes all dashboard panel messages
- Phase 2 target: keeps the tagged dashboard post but updates it to an empty-dashboard state

Acknowledgement:
- short reset confirmation, typically ephemeral when supported

## `/characters list`

Shows the currently tracked characters for the current guild.

Behavior:
- returns each tracked character's display name and numeric ID
- reports when no characters are tracked

Dashboard effect:
- none

Acknowledgement:
- short informational reply, typically ephemeral when supported

## `/characters refresh`

Triggers one immediate refresh cycle.

Behavior:
- refreshes all currently tracked characters once
- does not change whether automatic tracking is enabled

Channel restriction:
- Phase 1: dashboard channel only
- Phase 2 target: the configured bot channel

Dashboard effect:
- Phase 1: edits each tracked character panel message in place
- Phase 2 target: edits the tagged dashboard post in place, replacing its image attachments as needed

Acknowledgement:
- temporary acknowledgement that should disappear after the refresh completes

## `/characters tracking start [pollingPeriod]`

Starts automatic polling.

Arguments:
- `pollingPeriod`: optional positive integer number of seconds

Behavior:
- default polling period is `60`
- if already running with the same interval, reports that tracking is already ongoing
- if already running with a different supplied interval, restarts tracking with the new interval
- if nothing is tracked yet, reports that there is nothing to poll

Dashboard effect:
- future poll cycles refresh the dashboard automatically

Acknowledgement:
- short status message, typically ephemeral when supported

## `/characters tracking stop`

Stops automatic polling.

Behavior:
- stops the background polling loop
- leaves the current dashboard visible

Dashboard effect:
- none immediately beyond stopping future automatic updates

Acknowledgement:
- short status message, typically ephemeral when supported

---

## Validation And Channel Rules

- `characterID` values must be numeric.
- Phase 1: config commands belong in the configured configuration channel, and `/characters refresh` belongs in the configured dashboard channel.
- Phase 2 target: all commands belong in the configured bot channel.
- If a command is used in the wrong channel, the bot should acknowledge that and point to the correct one.
- If channel configuration is missing, the bot should acknowledge what is missing instead of failing silently.

---

## Operator Notes

- The current slash commands are defined in [src/bot.ts](/c:/repos/starfinder-character-bot-ts/src/bot.ts).
- The authoritative behavior specs live in:
  - [docs/prototype-spec.md](/c:/repos/starfinder-character-bot-ts/docs/prototype-spec.md) for Phase 1
  - [docs/phase-2-spec.md](/c:/repos/starfinder-character-bot-ts/docs/phase-2-spec.md) for Phase 2 and later implementation work until superseded
