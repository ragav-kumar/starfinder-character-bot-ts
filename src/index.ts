import { createDiscordClient } from "./bot.js";
import { loadRuntimeConfig } from "./config.js";

const config = loadRuntimeConfig();
const client = createDiscordClient(config);

await client.login(config.discordBotToken);
