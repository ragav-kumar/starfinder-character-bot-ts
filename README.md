# starfinder-character-bot-ts

A TypeScript Discord bot prototype for tracking Starfinder character sheets and
posting a persistent composite image dashboard in Discord.

For slash commands and expected bot behavior, see the [command reference](docs/command-reference.md).

## Configuration

Create a `.env` file with:

```dotenv
DISCORD_BOT_TOKEN=your-discord-token
STARFINDER_SITE_BASE_URL=https://your-private-site/Starfinder/Character-sheet.php
```

The bot now works in any guild text channel where it has permission to view the
channel, send messages, attach files, and read message history. Each channel
maintains its own tracked roster, polling state, and persistent dashboard post.

## Scripts

```bash
npm install
npm run lint
npm run build
npm test
npm start
```

`npm run build` and `npm start` both run `npm audit` and `npm run lint` first
through their npm lifecycle hooks, so dependency vulnerabilities and lint issues
are checked automatically before compiling or starting the bot.
