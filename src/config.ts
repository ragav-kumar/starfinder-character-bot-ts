import { config as loadDotEnv } from "dotenv";

import type { RuntimeConfig } from "./types.js";

let loaded = false;

function ensureDotEnvLoaded(): void {
  if (!loaded) {
    loadDotEnv();
    loaded = true;
  }
}

function requireEnv(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  ensureDotEnvLoaded();

  const discordBotToken = requireEnv("DISCORD_BOT_TOKEN", env);
  const siteBaseUrl = requireEnv("STARFINDER_SITE_BASE_URL", env);

  try {
    new URL(siteBaseUrl);
  } catch {
    throw new Error("STARFINDER_SITE_BASE_URL must be a valid absolute URL.");
  }

  return {
    discordBotToken,
    siteBaseUrl,
  };
}
