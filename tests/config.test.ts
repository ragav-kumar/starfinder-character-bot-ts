import { describe, expect, test } from "vitest";

import { loadRuntimeConfig } from "../src/config.js";
import { buildCharacterUrl } from "../src/fetcher.js";

describe("loadRuntimeConfig", () => {
  test("loads required env vars", () => {
    const config = loadRuntimeConfig({
      DISCORD_BOT_TOKEN: "token",
      STARFINDER_SITE_BASE_URL: "https://example.invalid/Character-sheet.php",
    });

    expect(config.discordBotToken).toBe("token");
    expect(config.siteBaseUrl).toBe("https://example.invalid/Character-sheet.php");
  });

  test("fails when DISCORD_BOT_TOKEN is missing", () => {
    expect(() =>
      loadRuntimeConfig({
        STARFINDER_SITE_BASE_URL: "https://example.invalid/Character-sheet.php",
      }),
    ).toThrow("DISCORD_BOT_TOKEN");
  });

  test("fails when STARFINDER_SITE_BASE_URL is missing", () => {
    expect(() =>
      loadRuntimeConfig({
        DISCORD_BOT_TOKEN: "token",
      }),
    ).toThrow("STARFINDER_SITE_BASE_URL");
  });
});

describe("buildCharacterUrl", () => {
  test("uses the configured base url instead of a hardcoded constant", () => {
    const url = buildCharacterUrl("https://private.example.test/path/Character-sheet.php", "110");
    expect(url).toBe("https://private.example.test/path/Character-sheet.php?characterID=110");
  });
});
