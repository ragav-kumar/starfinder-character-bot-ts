# Project Guidelines

## Current Status
- Treat the current Python implementation as a **working prototype** guided by `docs/prototype-spec.md`.
- Prefer **small, reversible edits** over broad refactors or new abstractions unless the user explicitly asks for them.
- Do not infer long-term architecture from the current file layout; keep the simple module structure unless a later spec or explicit request calls for redesign.
- The authoritative prototype behavior spec is `docs/prototype-spec.md`. If the code and the spec disagree, follow the spec.

## Architecture
- `bot.py`: Discord bot entry point and command handlers.
- `fetcher.py`: URL building and async HTTP fetch logic.
- `tests/`: offline pytest coverage for bot and fetcher behavior.

For setup and usage details, see `README.md`.

## Build and Test
- Prefer **Python 3.12** for local work.
- Install runtime dependencies with `python -m pip install -r requirements.txt`.
- Install test dependencies with `python -m pip install -r requirements-dev.txt`.
- Run tests with `python -m pytest -q`.
- Runtime requires `DISCORD_BOT_TOKEN`; tests should stay fully offline.

> Verified note: on 2026-04-07, `discord.py==2.3.2` failed under Python 3.14 during test collection with `ModuleNotFoundError: audioop`.

## Conventions
- Keep code straightforward, async-friendly, and type-hinted.
- Match the existing simple module structure unless a task explicitly asks for redesign.
- When testing, use mocks and temp state for Discord/network behavior; do not rely on live services.
- If requirements are unclear, preserve behavior and leave room for the later formal spec.

## Delivery Status
- Treat the current bot as a working prototype baseline rather than an in-progress phase scaffold.
- Prefer small, demonstrable fixes with verification over speculative broad refactors.
