import { describe, expect, test, vi } from "vitest";

import { logException } from "../src/logging.js";

describe("logException", () => {
  test("formats Discord API errors as compact readable lines", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = Object.assign(new Error("Unknown interaction"), {
      name: "DiscordAPIError[10062]",
      code: 10062,
      status: 404,
      method: "POST",
      url: "https://discord.com/api/v10/interactions/example/callback",
      rawError: {
        code: 10062,
        message: "Unknown interaction",
      },
    });

    logException("createDiscordClient.interactionCreate", error, {
      guildId: "guild-1",
      channelId: "channel-1",
      commandName: "characters",
    });

    expect(spy).toHaveBeenNthCalledWith(
      1,
      "[createDiscordClient.interactionCreate] DiscordAPIError[10062]: Unknown interaction",
    );
    expect(spy).toHaveBeenNthCalledWith(
      2,
      "Context: guildId=guild-1, channelId=channel-1, commandName=characters",
    );
    expect(spy).toHaveBeenNthCalledWith(3, "Details: code=10062, status=404");
    expect(spy).toHaveBeenNthCalledWith(
      4,
      "Details: method=POST, url=https://discord.com/api/v10/interactions/example/callback",
    );
    expect(spy).toHaveBeenNthCalledWith(5, "Details: apiCode=10062, apiMessage=Unknown interaction");
    expect(spy).toHaveBeenLastCalledWith(expect.stringContaining("Stack:"));

    spy.mockRestore();
  });
});
