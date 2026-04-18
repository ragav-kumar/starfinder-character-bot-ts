import { config as loadDotEnv } from "dotenv";

import type { GuildChannels, RuntimeConfig } from "./types.js";

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

function parseGuildChannelConfig(raw: string): Record<string, GuildChannels> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`GUILD_CHANNEL_CONFIG must be valid JSON: ${String(error)}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("GUILD_CHANNEL_CONFIG must be a JSON object keyed by guild ID.");
  }

  const result: Record<string, GuildChannels> = {};

  for (const [guildId, value] of Object.entries(parsed)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`GUILD_CHANNEL_CONFIG entry for guild ${guildId} must be an object.`);
    }

    const configChannelId = String((value as Record<string, unknown>).configChannelId ?? "").trim();
    const dashboardChannelId = String((value as Record<string, unknown>).dashboardChannelId ?? "").trim();

    if (!configChannelId || !dashboardChannelId) {
      throw new Error(
        `GUILD_CHANNEL_CONFIG entry for guild ${guildId} must include configChannelId and dashboardChannelId.`,
      );
    }

    result[guildId] = { configChannelId, dashboardChannelId };
  }

  return result;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  ensureDotEnvLoaded();

  const discordBotToken = requireEnv("DISCORD_BOT_TOKEN", env);
  const siteBaseUrl = requireEnv("STARFINDER_SITE_BASE_URL", env);
  const guildChannelConfig = parseGuildChannelConfig(requireEnv("GUILD_CHANNEL_CONFIG", env));

  try {
    new URL(siteBaseUrl);
  } catch {
    throw new Error("STARFINDER_SITE_BASE_URL must be a valid absolute URL.");
  }

  return {
    discordBotToken,
    siteBaseUrl,
    guildChannelConfig,
  };
}
