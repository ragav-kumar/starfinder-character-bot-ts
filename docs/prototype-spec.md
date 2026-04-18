# Starfinder Character Bot Phase 1 Prototype Specification

**Status:** Implemented Phase 1 reference specification  
**Date:** 2026-04-07  
**Source of truth:** This document defines the intended and shipped Phase 1 behavior. If the current Phase 1 codebase disagrees, follow this spec. If a later numbered phase spec disagrees, the later phase spec takes priority.  
**Change control:** Do not revise this specification unless a human explicitly requests a spec update. Preserve it as the Phase 1 historical/reference document.

**Phase note:** This document is retained to describe the original message-based prototype implementation. Phase 2 and later specs define subsequent iterations and override this document where they conflict.

---

## 1. Purpose

This Discord bot tracks one or more Starfinder characters hosted on Joe's Corner character-sheet pages and presents their current state in Discord.

The bot is centered on the URL pattern:

```text
https://<site_url>?characterID=<numeric id>
```

Each tracked character is identified by the numeric `characterID` query parameter from that page URL.

---

## 2. Prototype Scope

This phase is a **rough prototype implementation spec**, not a full production design.

### In scope
- Tracking multiple character IDs
- Manual refresh and optional periodic polling
- A persistent dashboard display in Discord
- Basic scrape/error handling and user acknowledgement

### Out of scope
- Any persistence across bot restarts; this bot is intentionally transient
- Historical logs or audit trails
- Multiple dashboard layouts per server
- Full character-sheet coverage beyond the fields listed below
- Dedicated channel-setup commands (channel IDs may be configured separately)

---

## 3. Runtime Model

### 3.1 Guild scope
Behavior is scoped **per Discord server/guild**.

Each guild has:
- one **configuration channel** for normal bot management commands
- one **dashboard channel** where the tracked-character panels live

For this prototype, the existence of those channels is assumed/configured outside the command set described here.

### 3.2 State model
For each guild, the bot maintains in memory:
- the set of tracked `characterID` values
- whether periodic tracking is currently enabled
- the polling interval in seconds
- the last successfully scraped snapshot for each character
- the dashboard message/panel associated with each tracked character

> Design note: this state is intentionally in-memory only and should reset when
> the bot restarts.

---

## 4. Acknowledgement Rules

All commands must produce some form of acknowledgement.

### General rules
- Commands run in the **configuration channel** should return a short acknowledgement message.
- If slash-command ephemeral replies are available, they are preferred for routine config acknowledgements.
- If a command is used in the wrong channel, the bot should acknowledge that and direct the user to the correct channel.

### Dashboard-only refresh rule
`/characters refresh` is special:
- it is only valid in the **dashboard channel**
- its acknowledgement should be **temporary**
- once the refresh finishes, the acknowledgement should disappear rather than remain in channel history

---

## 5. Commands

## 5.1 `/characters add <characterIDs>`

Add one or more characters to the watch list.

### Input
- `characterIDs` is one or more numeric IDs separated by spaces
- Example:
  ```text
  /characters add 110 245 381
  ```

### Expected behavior
- Process each ID independently in a single command invocation.
- For each valid, reachable character page:
  - resolve the character's display name
  - add it to the watch list
  - create its dashboard panel if one does not already exist
  - populate the panel immediately if data can be fetched at add time
- For duplicates:
  - acknowledge that the character is already being tracked
  - use the character name in the acknowledgement when it can be resolved
  - do not create a duplicate panel
- For invalid or unreachable IDs:
  - report an error for that specific ID
  - do not add it to the watch list

### Response style
Return a concise per-ID summary using character names where available, e.g.:
- `Added: Paul-Paul Atreides (110), Nyx (245)`
- `Already tracked: Paul-Paul Atreides (110)`
- `Failed: 999999 (page not reachable)`

---

## 5.2 `/characters remove <characterID>`

Remove a character from the watch list.

### Expected behavior
- If the ID is currently tracked:
  - remove it from the tracked set
  - delete its dashboard panel/message
  - acknowledge removal using the character's last known name, plus the ID if useful
- If the ID is not currently tracked:
  - acknowledge that it was not being tracked

---

## 5.3 `/characters clear`

Remove all tracked characters for the current guild.

### Expected behavior
- clear the tracked list
- delete all dashboard panels/messages
- stop periodic tracking if it is running
- acknowledge the reset

---

## 5.4 `/characters list`

Show the current tracked-character registry for the current guild/server.

### Expected behavior
- return a concise list of all currently tracked characters for that guild
- each entry should include:
  - the character's display name
  - the numeric `characterID`
- this command is useful both for debugging and as normal user-facing information
- if no characters are currently tracked, acknowledge that the registry is empty

### Response style
Examples:
- `Tracked characters: Paul-Paul Atreides (110), Nyx (245)`
- `No characters are currently being tracked.`

### Notes
- this is a read-only informational command
- it does not create, remove, or refresh dashboard panels
- it is scoped per guild, like the rest of the in-memory tracking state

---

## 5.5 `/characters tracking start [pollingPeriod]`

Start automatic polling.

### Input
- `pollingPeriod` is optional
- default value: `60` seconds
- if supplied, it must be a positive integer number of seconds

### Expected behavior
- If tracking is already running and `pollingPeriod` is provided and differs from the current interval:
  - restart tracking using the new interval
  - acknowledge that tracking was restarted with the new polling period
- If tracking is already running and `pollingPeriod` is omitted:
  - acknowledge that tracking is already ongoing
  - include the existing polling period in the acknowledgement
- If tracking is already running and `pollingPeriod` matches the current interval:
  - treat it the same as omitting the argument
  - acknowledge that tracking is already ongoing with that period
- If no characters are currently tracked:
  - acknowledge the request, but report that there is nothing to poll yet
- When active:
  - the bot polls each tracked character on the configured interval
  - each poll checks for updated displayed values and refreshes the relevant panel

---

## 5.6 `/characters tracking stop`

Stop automatic polling.

### Expected behavior
- stop the background polling loop
- leave the current dashboard panels visible
- acknowledge that tracking has stopped

---

## 5.7 `/characters refresh`

Manually trigger one immediate refresh cycle.

### Expected behavior
- may be run whether automatic tracking is currently on or off
- checks all currently tracked characters once
- updates dashboard panels using the latest successfully scraped data
- does **not** change the persistent on/off tracking state

### Channel restriction
- this command is valid only in the **dashboard channel**

### Visibility rule
- the command acknowledgement should appear briefly and then be removed
- the command invocation itself should not leave behind clutter in the dashboard

---

## 6. Dashboard Behavior

## 6.1 Message model
The dashboard should contain **one persistent formatted message/panel per tracked character**.

Recommended ordering:
- keep a stable order based on add order or character name
- avoid reshuffling panels on every refresh

### Update behavior
- panel messages should be edited in place when data changes
- automatic tracking should not create a new persistent message on every poll

## 6.2 Required fields per panel
Each character panel must show the following, when available:
- **Name**
- **Initiative** (total only)
- **Health/Resolve section data**
  - current and total **HP**
  - current and total **Stamina**
  - current and total **Resolve**
- **Conditions**
  - derived from the character state and additional-modifier style fields
- **EAC**
- **KAC**
- **Saving throws**
- **Attack bonuses** (total only)
- **Equipped weapon** information, including:
  - weapon name
  - ammo
  - damage type
  - range
  - damage

If a field cannot be extracted reliably, the panel should show `Unavailable` rather than fail completely.

## 6.3 Panel format goal
The exact layout may evolve, but it should read like a compact status card.

Example mockup:

```md
**Paul-Paul Atreides**  (`ID: 110`)
Initiative: `+5`
HP/SP/RP: `24/24 | 18/18 | 5/5`
Conditions: `Off-kilter, Prone`
EAC/KAC: `14 / 16`
Saves: `Fort +4 | Ref +6 | Will +7`
Attack: `+8`
Weapon: `Laser Pistol` — `1d4 fire`, `80 ft`, `52/52 ammo`
_Last updated: 2026-04-07 21:15 UTC_
```

The prototype may use plain text, embeds, or another simple Discord-native formatting approach.

---

## 7. Polling and Change Detection

## 7.1 Polling loop
When tracking is enabled, the bot should periodically:
1. fetch each tracked character page
2. scrape the fields required for the dashboard
3. compare the current snapshot against the previous snapshot
4. update the dashboard panel if any displayed value changed

## 7.2 Change notifications
When a poll detects a meaningful change, the bot should:
- update the persistent panel in place
- also post a **temporary change summary** in the dashboard channel

Examples:
- `Paul-Paul Atreides: HP changed 24 → 18`
- `Paul-Paul Atreides: condition added: Off-kilter`

These notifications should be short-lived and should not become a permanent log.

## 7.3 No-change behavior
- Automatic polls do not need to announce anything if no displayed fields changed.
- Manual refresh may acknowledge `No changes found` if appropriate.

---

## 8. Scraping Rules

The source website is a human-oriented HTML page and may be structurally inconsistent.

### Prototype scraping requirements
- scrape only the fields needed for the dashboard
- prefer resilient parsing over brittle exact-position assumptions
- tolerate missing sections or field-label variations where possible
- combine the relevant condition-like information from the page's character state and additional-modifier areas

### Staleness indicator
If the bot cannot refresh a panel during an expected update window, that panel should visibly indicate that its data is **stale**.

Examples of acceptable indicators:
- a `STALE` label
- a warning emoji/icon
- text that the last refresh failed or is outdated

This stale indicator should persist until a later successful refresh makes the panel current again.

### Failure handling
If a page cannot be fetched or parsed:
- keep the previous successful dashboard data visible if it exists
- do not erase a good panel with blank values
- mark the panel as stale until a successful refresh clears that state
- acknowledge the failure in a short error message when the failure is user-triggered
- for automatic polling, avoid spamming repeated identical errors into the channel

---

## 9. Validation and Error Handling

### Invalid input
- Non-numeric `characterID` values are rejected with an error acknowledgement.
- Duplicate IDs should return an `already tracked` acknowledgement.

### Unreachable or missing character pages
If the source page is unreachable, missing, or clearly invalid:
- do not add the character
- return a short error acknowledgement

### Missing channel setup
If the required dashboard/config channel configuration is missing, the bot should:
- acknowledge the command
- explain what is missing
- avoid silently failing

---

## 10. Non-Goals for This Version

The following are intentionally deferred or excluded:
- advanced permissions/roles model
- rich administration UI
- long-term change history
- support for multiple dashboards per guild
- comprehensive scraping of every character-sheet field

---

## 11. Prototype Maintenance Notes

These notes are included only to guide ongoing prototype revisions and are not architecture mandates:
- prefer true Discord slash commands over prefix commands
- keep acknowledgement behavior lightweight and non-spammy
- keep the implementation simple and reversible
- do not treat the existing Python scaffold as authoritative design
