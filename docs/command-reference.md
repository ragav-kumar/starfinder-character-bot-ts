# Starfinder Character Bot Command Reference

**Audience:** Human operators and testers  
**Purpose:** Reference for the bot's current slash commands and visible behavior  
**Maintenance rule:** Update this document any time supported commands, arguments, channel restrictions, acknowledgements, or dashboard side effects change.

---

## Overview

The bot exposes one slash-command group:

```text
/characters
```

Channel model:
- use the configured bot channel for all commands
- the authoritative dashboard post also lives in that same bot channel

Dashboard model:
- each guild has one authoritative dashboard post
- the message body starts with a bot-readable metadata block
- the dashboard post attachments contain one rendered image per tracked character
- routine updates edit the same dashboard post in place

If no characters are tracked, the dashboard post remains in place with empty tracked metadata and no character images.

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
- fetches character data immediately for newly added characters

Dashboard effect:
- edits the authoritative dashboard post so each newly tracked character appears as a new image attachment
- keeps attachment order aligned with tracked-character order

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
- edits the authoritative dashboard post so that character's image is removed
- updates dashboard metadata to keep the tracked roster in sync

Acknowledgement:
- short success or not-tracked message, typically ephemeral when supported

## `/characters clear`

Removes all tracked characters for the current guild.

Behavior:
- clears the tracked roster
- stops automatic tracking

Dashboard effect:
- keeps the authoritative dashboard post
- updates it to an empty-dashboard state with no character images

Acknowledgement:
- short reset confirmation, typically ephemeral when supported

## `/characters list`

Shows the currently tracked characters for the current guild.

Behavior:
- returns each tracked character's display name and numeric ID when available
- reports when no characters are tracked
- may recover the tracked roster from the authoritative dashboard metadata if the bot has restarted

Dashboard effect:
- none

Acknowledgement:
- short informational reply, typically ephemeral when supported

## `/characters refresh`

Triggers one immediate refresh cycle.

Behavior:
- refreshes all currently tracked characters once
- does not change whether automatic tracking is enabled
- keeps the tracked roster even if one or more refreshes fail

Dashboard effect:
- edits the authoritative dashboard post in place
- replaces the image attachment set as a synchronized group
- keeps the previous successful character data visible when possible and marks failed characters stale

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
- All commands must be run in the configured bot channel.
- If a command is used in the wrong channel, the bot should acknowledge that and point to the correct one.
- If bot-channel configuration is missing, the bot should acknowledge what is missing instead of failing silently.
- If a tagged dashboard post cannot be recovered, the bot may create a new clean authoritative post when a dashboard-affecting command runs.

---

## Operator Notes

- The current slash commands are defined in [src/bot.ts](/c:/repos/starfinder-character-bot-ts/src/bot.ts).
- The authoritative dashboard metadata format and recovery helpers live in [src/dashboard.ts](/c:/repos/starfinder-character-bot-ts/src/dashboard.ts).
