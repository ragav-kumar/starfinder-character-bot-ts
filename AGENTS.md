# Repository Instructions

This repository is a TypeScript Discord bot prototype for tracking Starfinder character sheets and rendering status panels in Discord.

## What Matters Most

- Keep edits small and behavior-focused unless the user explicitly asks for a redesign.
- Preserve the current separation of concerns:
  - `src/index.ts` loads environment configuration and starts the Discord client.
  - `src/bot.ts` owns Discord-specific wiring, slash command registration, and interaction adapters.
  - `src/service.ts` contains the main application behavior for tracking, refreshing, and polling.
  - `src/fetcher.ts` builds character URLs, fetches HTML, and scrapes dashboard fields from the Starfinder sheet.
  - `src/rendering.ts` formats Discord panel content and snapshot diffs.
  - `src/state.ts` stores in-memory per-guild tracking state.
  - `src/types.ts` defines the shared runtime and service interfaces.

## Runtime And Config

- Runtime configuration comes from environment variables via `loadRuntimeConfig()` in `src/config.ts`.
- Required variables are:
  - `DISCORD_BOT_TOKEN`
  - `STARFINDER_SITE_BASE_URL`
  - `GUILD_CHANNEL_CONFIG`
- `GUILD_CHANNEL_CONFIG` must be JSON keyed by guild ID, with `configChannelId` and `dashboardChannelId` for each guild.

## Development Workflow

- Install dependencies with `npm install`.
- Validate changes with:
  - `npm run lint`
  - `npm run build`
  - `npm test`
- Tests use Vitest and should stay offline. Prefer mocks, fakes, and injected dependencies over live Discord or network calls.

## Coding Conventions

- Prefer modern TypeScript with explicit types at module boundaries.
- Keep Discord platform details inside `src/bot.ts` and business rules inside `src/service.ts`.
- When adding behavior, extend existing interfaces and constructor injection seams instead of introducing global state.
- Keep rendered dashboard output and command acknowledgements consistent with current behavior unless a task explicitly changes product behavior.
- Treat `templates/character-card.html` as effectively frozen unless the user explicitly asks for a template redesign.
- Do not modify `templates/character-card.html` for cosmetic or layout reasons. Outside of an explicit redesign request, template edits are allowed only to ensure the file exists, remains `satori` compatible, and uses only ids that map to supported template variables.
- Preserve channel restrictions:
  - config actions belong in the configured config channel
  - refresh actions belong in the dashboard channel

## Testing Guidance

- Add or update tests when changing:
  - env parsing in `src/config.ts`
  - HTML scraping in `src/fetcher.ts`
  - tracking, refresh, or polling behavior in `src/service.ts`
- Rendering tests must not assume the checked-in template's shape or that any particular template variable is used. The only safe assumptions are that the template file exists, renders through the `satori` pipeline, and any ids present map to supported template variables.
- Favor regression-style tests that exercise user-visible behavior through the service layer.
- For scraping changes, use small inline HTML fixtures similar to the existing tests.

## Delivery Expectations

- Prefer concrete, verified fixes over speculative refactors.
- If requirements are unclear, preserve current behavior and document any assumptions in the response.
- Keep `README.md` human-facing. Do not add agent-focused, task-routing, or Codex-specific process language to the README; put that guidance in `AGENTS.md` instead.
