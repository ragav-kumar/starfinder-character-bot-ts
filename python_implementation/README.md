# starfinder-character-bot

A Discord bot prototype for tracking Starfinder character sheets hosted on
[Joe's Corner](https://www.joescorner.ca/Starfinder/) and presenting them in
Discord.

> **Disclaimer:** this repo was vibe-coded as a fast-moving prototype, so expect
> rough edges and iterative changes.

---

## Current repo state

### ✅ Implemented through Phase 2
- guild-scoped in-memory tracked-character state
- `characters add`, `characters remove`, and `characters clear`
- immediate Joe's Corner scraping on `/characters add`
- one populated markdown dashboard panel per tracked character
- offline pytest coverage for both tracking flow and HTML scraping

### 🚧 Not implemented yet
- manual refresh and periodic polling
- in-place dashboard updates after later refreshes
- dedicated configuration/dashboard channel setup

> The bot is intentionally lightweight and transient: tracked state resets on
> restart.
>
> In the current prototype, dashboard panels are still posted in the same
> channel where the command is run.

---

## Prerequisites

| Tool | Recommended version | Notes |
|---|---|---|
| Python | 3.12 | Preferred for local runtime compatibility |
| pip | bundled with Python | Used for dependency installation |
| Discord bot token | current | Required only for running the bot |

> `discord.py==2.3.2` is known to fail under Python 3.14 because `audioop`
> was removed from the stdlib. Use Python 3.12 when launching the bot locally.

---

## 1 — Create a Discord bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Create a new application and add a bot user.
3. Copy the bot token and keep it secret.
4. Invite the bot to a server you control.
5. The current prototype exposes slash commands such as
   `/characters add`, `/characters remove`, and `/characters clear`.

---

## 2 — Clone and install

```bash
git clone https://github.com/ragav-kumar/starfinder-character-bot.git
cd starfinder-character-bot

python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

python -m pip install -r requirements.txt
python -m pip install -r requirements-dev.txt
```

---

## 3 — Configure the bot token

Set `DISCORD_BOT_TOKEN` before starting the bot.

```powershell
# PowerShell
$env:DISCORD_BOT_TOKEN="your-token-here"
```

```bash
# macOS / Linux
export DISCORD_BOT_TOKEN="your-token-here"
```

---

## 4 — Run the bot

```bash
python bot.py
```

When the bot is online, use the current slash commands:

```text
/characters add 110 245
/characters remove 110
/characters clear
```

Routine acknowledgements are sent as slash-command responses, while `/characters add`
fetches the Joe's Corner sheet and posts a populated dashboard card into the active channel.

---

## 5 — Run the tests

```bash
python -m pytest -q
```

The tests are fully offline and do not require a Discord token or live network
access.

---

## Project layout

```text
starfinder-character-bot/
├── bot.py               # Discord entry point and tracking/dashboard commands
├── fetcher.py           # Joe's Corner URL helpers, async fetch, and scraping logic
├── docs/
│   └── prototype-spec.md
└── tests/
    ├── test_bot.py
    └── test_fetcher.py
```

The authoritative behavior spec is `docs/prototype-spec.md`. If the code and
the README ever disagree, follow the spec and then update the README.
