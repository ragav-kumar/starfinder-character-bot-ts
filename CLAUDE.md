# Claude Code Instructions

@AGENTS.md

The repository rules in `AGENTS.md` (imported above) apply to you in full. This file adds Claude-specific guidance on how to read the specs, how phases are run, and where the docs are known to disagree with the code. It does not relax any rule in `AGENTS.md`.

## Specs Are The Source Of Truth

- Product behavior is defined by the numbered phase specs in `docs/`. `docs/prototype-spec.md` is Phase 1; later files are `docs/phase-N-spec.md`.
- A higher-numbered **accepted** phase spec overrides lower-numbered specs where they conflict. Read the latest accepted spec first, then earlier ones for anything it does not restate.
- Do not edit an accepted or historical spec unless the user explicitly asks for a spec change. Sketch specs are the exception (see below).
- `docs/command-reference.md` is the human-facing command reference. It does not override the specs. Whenever commands or user-visible command behavior change, update it and the governing spec in the same change.

## Sketch Specs

- A spec whose status line says **Sketch** is a placeholder for scope and goals only.
- Sketches may be edited freely (fleshed out, rescoped, reworded) while they remain Sketches. The usual spec change-control rule applies only once a spec has been accepted.
- Do not implement, plan code changes against, or modify code because of a Sketch spec.
- A Sketch becomes actionable only after the user has fleshed it out (with your help, if asked) and explicitly accepted it, and its status line has been changed to show that acceptance.
- If asked to work on something covered only by a Sketch, say so and offer to help flesh the spec out instead.

## Phase Workflow

Each phase follows this loop:

1. Plan: propose the implementation plan for the accepted phase spec and wait for the user's go-ahead.
2. Implement and validate with `npm run lint`, `npm run build`, and `npm test`.
3. Human testing: the user tests the bot. Iterate on their feedback.
4. The user decides when the phase is complete. Do not treat a phase as done, or start the next phase, until the user says so.

## Known Discrepancies Between Docs And Code

These existed before this file was added. Do not silently resolve them in either direction; follow current code behavior (per the `AGENTS.md` rule to preserve current behavior when requirements are unclear) and raise the discrepancy with the user when it matters to your task.

- `AGENTS.md` lists `GUILD_CHANNEL_CONFIG` as required and describes separate config and dashboard channels. The code requires only `DISCORD_BOT_TOKEN` and `STARFINDER_SITE_BASE_URL`, and commands work in any guild text channel with per-channel state.
- Phase 2/3 specs define a `[starfinder-character-bot dashboard v1]` metadata block scoped per guild. The code writes a `v2` marker with an added `channelId` line and keeps one dashboard per channel.
- `.github/copilot-instructions.md` is an outdated copy of `AGENTS.md`.
- `docs/command-reference.md` links to local `c:/repos/...` paths.
