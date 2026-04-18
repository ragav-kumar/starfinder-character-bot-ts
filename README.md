# starfinder-character-bot-ts

A TypeScript Discord bot prototype for tracking Starfinder character sheets and
presenting them in Discord.

## Configuration

Create a `.env` file with:

```dotenv
DISCORD_BOT_TOKEN=your-discord-token
STARFINDER_SITE_BASE_URL=https://your-private-site/Starfinder/Character-sheet.php
GUILD_CHANNEL_CONFIG={"123456789012345678":{"configChannelId":"111111111111111111","dashboardChannelId":"222222222222222222"}}
```

`GUILD_CHANNEL_CONFIG` is a JSON object keyed by guild ID. Each value must
include `configChannelId` and `dashboardChannelId`.

## Scripts

```bash
npm install
npm test
npm start
```
