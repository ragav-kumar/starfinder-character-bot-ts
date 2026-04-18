import { logException } from "./logging.js";
import { createDiscordClient } from "./bot.js";
import { loadRuntimeConfig } from "./config.js";

process.on("unhandledRejection", (error) => {
  logException("process.unhandledRejection", error);
});

process.on("uncaughtException", (error) => {
  logException("process.uncaughtException", error);
});

const config = loadRuntimeConfig();
const client = createDiscordClient(config);

await client.login(config.discordBotToken);
