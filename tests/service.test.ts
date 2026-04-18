import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Mock } from "vitest";

import { formatDashboardMetadata } from "../src/dashboard.js";
import { CharacterBotService } from "../src/service.js";
import { GuildStateStore } from "../src/state.js";
import type {
  CommandTarget,
  DashboardAttachment,
  DashboardMessageSnapshot,
  DashboardStore,
  ExistingDashboardAttachment,
  RuntimeConfig,
} from "../src/types.js";

class FakeDashboardStore implements DashboardStore {
  readonly created: DashboardMessageSnapshot[] = [];
  readonly edited: Array<{ messageId: string; content: string; attachments: DashboardAttachment[] }> = [];
  messagesByChannel = new Map<string, DashboardMessageSnapshot[]>();
  nextId = 1;

  async listChannelMessages(channelId: string): Promise<DashboardMessageSnapshot[]> {
    return [...(this.messagesByChannel.get(channelId) ?? [])];
  }

  async createMessage(
    channelId: string,
    content: string,
    attachments: DashboardAttachment[],
  ): Promise<DashboardMessageSnapshot> {
    const snapshot = this.buildMessage(channelId, String(this.nextId++), content, attachments);
    this.created.push(snapshot);
    this.messagesByChannel.set(channelId, [snapshot]);
    return snapshot;
  }

  async editMessage(
    channelId: string,
    messageId: string,
    content: string,
    attachments: DashboardAttachment[],
  ): Promise<DashboardMessageSnapshot> {
    this.edited.push({ messageId, content, attachments });
    const snapshot = this.buildMessage(channelId, messageId, content, attachments);
    this.messagesByChannel.set(channelId, [snapshot]);
    return snapshot;
  }

  seed(channelId: string, messages: DashboardMessageSnapshot[]): void {
    this.messagesByChannel.set(channelId, messages);
  }

  private buildMessage(
    channelId: string,
    id: string,
    content: string,
    attachments: DashboardAttachment[],
  ): DashboardMessageSnapshot {
    const existingAttachments: ExistingDashboardAttachment[] = attachments.map((attachment, index) =>
      attachment.kind === "existing"
        ? attachment
        : {
            kind: "existing",
            id: `${id}-${index + 1}`,
            filename: attachment.filename,
            characterId: attachment.characterId,
          },
    );

    return {
      id,
      channelId,
      content,
      attachments: existingAttachments,
      createdAt: new Date("2026-04-17T18:00:00Z"),
    };
  }
}

class FakeTarget implements CommandTarget {
  readonly supportsEphemeral = true;
  readonly acks: Array<{ content: string; temporary: boolean }> = [];

  constructor(
    public readonly guildId: string | null,
    public readonly channelId: string | null,
  ) {}

  async sendAck(content: string, options?: { ephemeral?: boolean; temporary?: boolean }): Promise<void> {
    this.acks.push({ content, temporary: Boolean(options?.temporary) });
  }
}

const config: RuntimeConfig = {
  discordBotToken: "token",
  siteBaseUrl: "https://private.example.test/Character-sheet.php",
  guildChannelConfig: {
    "1": {
      botChannelId: "200",
    },
  },
};

describe("CharacterBotService", () => {
  let stateStore: GuildStateStore;
  let fetchPage: Mock<(url: string) => Promise<string>>;
  let dashboardStore: FakeDashboardStore;
  let service: CharacterBotService;

  beforeEach(() => {
    stateStore = new GuildStateStore();
    dashboardStore = new FakeDashboardStore();
    fetchPage = vi.fn(async (url: string) => {
      const characterId = new URL(url).searchParams.get("characterID");
      if (characterId === "404") {
        throw new Error("missing");
      }
      return `<html><head><title>Character ${characterId} - Character Sheet</title></head></html>`;
    });
    service = new CharacterBotService({
      config,
      dashboardStore,
      stateStore,
      fetchPage,
      now: () => new Date("2026-04-17T18:30:00Z"),
    });
  });

  test("add tracks ids and creates one dashboard post", async () => {
    const target = new FakeTarget("1", "200");

    await service.addCharacters(target, "110 245");

    const state = stateStore.get("1");
    expect(state.trackedOrder).toEqual(["110", "245"]);
    expect(dashboardStore.created).toHaveLength(1);
    expect(dashboardStore.created[0]?.attachments).toHaveLength(2);
    expect(target.acks.at(-1)?.content).toContain("Added:");
  });

  test("add reports duplicates and invalid ids", async () => {
    const target = new FakeTarget("1", "200");

    await service.addCharacters(target, "110");
    await service.addCharacters(target, "110 abc 245");

    expect(target.acks.at(-1)?.content).toContain("Already tracked:");
    expect(target.acks.at(-1)?.content).toContain("abc");
  });

  test("commands reject the wrong bot channel", async () => {
    const target = new FakeTarget("1", "999");

    await service.listCharacters(target);

    expect(target.acks.at(-1)?.content).toContain("<#200>");
  });

  test("remove updates the authoritative dashboard", async () => {
    const target = new FakeTarget("1", "200");
    await service.addCharacters(target, "110 245");

    await service.removeCharacter(target, "110");

    expect(stateStore.get("1").trackedOrder).toEqual(["245"]);
    expect(dashboardStore.edited.at(-1)?.attachments).toHaveLength(1);
    expect(target.acks.at(-1)?.content).toContain("Removed:");
  });

  test("clear preserves an empty dashboard post and stops tracking", async () => {
    const target = new FakeTarget("1", "200");
    await service.addCharacters(target, "110 245");

    const state = stateStore.get("1");
    state.trackingEnabled = true;
    state.pollingController = { cancel: vi.fn() };

    await service.clearCharacters(target);

    expect(state.tracked.size).toBe(0);
    expect(state.trackingEnabled).toBe(false);
    expect(state.pollingController).toBeNull();
    expect(dashboardStore.edited.at(-1)?.attachments).toHaveLength(0);
    expect(dashboardStore.edited.at(-1)?.content).toContain("No characters are currently tracked.");
  });

  test("list recovers tracked ids from dashboard metadata after restart", async () => {
    dashboardStore.seed("200", [
      {
        id: "existing",
        channelId: "200",
        content: `${formatDashboardMetadata({
          guildId: "1",
          trackedCharacterIds: ["110", "245"],
          updatedAt: new Date("2026-04-17T18:00:00Z"),
        })}\n\nTracked characters: recovered`,
        attachments: [
          { kind: "existing", id: "a1", filename: "character-110.png", characterId: "110" },
          { kind: "existing", id: "a2", filename: "character-245.png", characterId: "245" },
        ],
        createdAt: new Date("2026-04-17T18:00:00Z"),
      },
    ]);
    const restartedService = new CharacterBotService({
      config,
      dashboardStore,
      stateStore: new GuildStateStore(),
      fetchPage,
    });
    const target = new FakeTarget("1", "200");

    await restartedService.listCharacters(target);

    expect(target.acks.at(-1)?.content).toContain("110");
    expect(target.acks.at(-1)?.content).toContain("245");
  });

  test("refresh updates dashboard attachments in tracked order and uses a temporary ack", async () => {
    const target = new FakeTarget("1", "200");
    await service.addCharacters(target, "110");

    fetchPage.mockResolvedValueOnce(`
      <html>
        <head><title>Character 110 - Character Sheet</title></head>
        <body>
          <input type="text" name="hp_total" value="7" />
          <input type="text" name="hp_current" value="0" />
          <input type="checkbox" checked name="condition_prone" />
        </body>
      </html>
    `);

    await service.refreshCharacters(target);

    expect(dashboardStore.edited.at(-1)?.attachments[0]?.kind).toBe("rendered");
    expect(target.acks.at(-1)).toEqual(expect.objectContaining({ temporary: true }));
  });

  test("refresh marks a character stale after failed fetch and preserves its attachment slot", async () => {
    const target = new FakeTarget("1", "200");
    await service.addCharacters(target, "110");

    fetchPage.mockRejectedValueOnce(new Error("boom"));

    await service.refreshCharacters(target);

    expect(stateStore.get("1").tracked.get("110")?.stale).toBe(true);
    expect(dashboardStore.edited.at(-1)?.attachments).toHaveLength(1);
  });

  test("tracking start and stop manage polling lifecycle", async () => {
    vi.useFakeTimers();
    const target = new FakeTarget("1", "200");
    await service.addCharacters(target, "110");

    await service.startTracking(target, 30);

    const state = stateStore.get("1");
    expect(state.trackingEnabled).toBe(true);
    expect(state.pollingPeriodSeconds).toBe(30);
    expect(state.pollingController).not.toBeNull();

    await service.stopTracking(target);

    expect(state.trackingEnabled).toBe(false);
    expect(state.pollingController).toBeNull();
    vi.useRealTimers();
  });

  test("tracking start reports empty registry", async () => {
    const target = new FakeTarget("1", "200");

    await service.startTracking(target);

    expect(target.acks.at(-1)?.content.toLowerCase()).toContain("nothing to poll");
  });

  test("tracking start reports already ongoing when interval matches", async () => {
    const target = new FakeTarget("1", "200");
    await service.addCharacters(target, "110");

    await service.startTracking(target, 60);
    await service.startTracking(target, 60);

    expect(target.acks.at(-1)?.content.toLowerCase()).toContain("already ongoing");
  });

  test("spec regression: add failure does not create a tracked record", async () => {
    const target = new FakeTarget("1", "200");

    await service.addCharacters(target, "404");

    expect(stateStore.get("1").tracked.has("404")).toBe(false);
    expect(target.acks.at(-1)?.content).toContain("Failed: 404 (page not reachable)");
  });

  test("missing channel setup is acknowledged", async () => {
    const noChannelService = new CharacterBotService({
      config: {
        ...config,
        guildChannelConfig: {},
      },
      dashboardStore,
      stateStore,
      fetchPage,
    });
    const target = new FakeTarget("1", "200");

    await noChannelService.listCharacters(target);

    expect(target.acks.at(-1)?.content).toContain("missing bot channel configuration");
  });

  test("multiple tagged posts recover from the most recently updated valid one", async () => {
    dashboardStore.seed("200", [
      {
        id: "old",
        channelId: "200",
        content: formatDashboardMetadata({
          guildId: "1",
          trackedCharacterIds: ["110"],
          updatedAt: new Date("2026-04-17T18:00:00Z"),
        }),
        attachments: [{ kind: "existing", id: "x1", filename: "character-110.png", characterId: "110" }],
        createdAt: new Date("2026-04-17T18:00:00Z"),
      },
      {
        id: "new",
        channelId: "200",
        content: formatDashboardMetadata({
          guildId: "1",
          trackedCharacterIds: ["245"],
          updatedAt: new Date("2026-04-17T19:00:00Z"),
        }),
        attachments: [{ kind: "existing", id: "x2", filename: "character-245.png", characterId: "245" }],
        createdAt: new Date("2026-04-17T19:00:00Z"),
      },
    ]);
    const restartedService = new CharacterBotService({
      config,
      dashboardStore,
      stateStore: new GuildStateStore(),
      fetchPage,
    });
    const target = new FakeTarget("1", "200");

    await restartedService.listCharacters(target);

    expect(target.acks.at(-1)?.content).toContain("245");
    expect(target.acks.at(-1)?.content).not.toContain("110");
  });
});
