import { describe, expect, test, vi } from "vitest";
import { MessageFlags } from "discord.js";

import { prepareInteractionAck, sendInteractionAck } from "../src/bot.js";

interface FakeInteraction {
  deferred: boolean;
  replied: boolean;
  deferReply: ReturnType<typeof vi.fn>;
  reply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
  deleteReply: ReturnType<typeof vi.fn>;
}

function createInteraction(overrides: Partial<FakeInteraction> = {}): FakeInteraction {
  return {
    deferred: false,
    replied: false,
    deferReply: vi.fn(async () => undefined),
    reply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
    deleteReply: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("interaction ack helpers", () => {
  test("prepareInteractionAck defers ephemeral replies before long-running work", async () => {
    const interaction = createInteraction();

    await prepareInteractionAck(interaction as never, { ephemeral: true });

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  });

  test("sendInteractionAck edits the deferred reply instead of sending a follow-up", async () => {
    const interaction = createInteraction({ deferred: true });

    await sendInteractionAck(interaction as never, "Added: Hero (123)", { ephemeral: true });

    expect(interaction.editReply).toHaveBeenCalledWith({ content: "Added: Hero (123)" });
    expect(interaction.followUp).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  test("sendInteractionAck still uses followUp after an interaction already replied", async () => {
    const interaction = createInteraction({ replied: true });

    await sendInteractionAck(interaction as never, "Tracked characters: Hero (123)", { ephemeral: true });

    expect(interaction.followUp).toHaveBeenCalledWith({
      content: "Tracked characters: Hero (123)",
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});
