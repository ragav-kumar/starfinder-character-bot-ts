import { beforeEach, describe, expect, test, vi } from "vitest";

import { CharacterBotService } from "../src/service.js";
import { GuildStateStore } from "../src/state.js";
import type { CommandTarget, PanelMessageHandle, RuntimeConfig, TemporaryMessageHandle } from "../src/types.js";

class FakeTemporaryMessage implements TemporaryMessageHandle {
  deleted = false;
  constructor(public readonly id: string) {}
  async delete(): Promise<void> {
    this.deleted = true;
  }
}

class FakeChannel {
  sent: FakeTemporaryMessage[] = [];
  constructor(public readonly id: string, private readonly contents: string[]) {}
  async send(content: string): Promise<FakeTemporaryMessage> {
    this.contents.push(content);
    const message = new FakeTemporaryMessage(String(this.sent.length + 1));
    this.sent.push(message);
    return message;
  }
}

class FakePanelMessage implements PanelMessageHandle {
  deleted = false;
  editCount = 0;
  readonly id: string;
  content: string;
  readonly channelId: string;
  readonly channel: FakeChannel;

  constructor(id: string, content: string, channelId: string, contents: string[]) {
    this.id = id;
    this.content = content;
    this.channelId = channelId;
    this.channel = new FakeChannel(channelId, contents);
  }

  async edit(content: string): Promise<void> {
    this.content = content;
    this.editCount += 1;
  }

  async delete(): Promise<void> {
    this.deleted = true;
  }
}

class FakeTarget implements CommandTarget {
  readonly supportsEphemeral = true;
  readonly acks: Array<{ content: string; temporary: boolean }> = [];
  readonly panels: FakePanelMessage[] = [];

  constructor(
    public readonly guildId: string | null,
    public readonly channelId: string | null,
    private readonly channelContents: string[],
  ) {}

  async sendAck(content: string, options?: { ephemeral?: boolean; temporary?: boolean }): Promise<void> {
    this.acks.push({ content, temporary: Boolean(options?.temporary) });
  }

  async sendPanel(content: string): Promise<PanelMessageHandle> {
    this.channelContents.push(content);
    const panel = new FakePanelMessage(String(this.panels.length + 1), content, "200", this.channelContents);
    this.panels.push(panel);
    return panel;
  }
}

const config: RuntimeConfig = {
  discordBotToken: "token",
  siteBaseUrl: "https://private.example.test/Character-sheet.php",
  guildChannelConfig: {
    "1": {
      configChannelId: "100",
      dashboardChannelId: "200",
    },
  },
};

const baseSnapshot = {
  name: "Character 110",
  initiative: "+0",
  hp: "1/1",
  stamina: "1/1",
  resolve: "1/1",
  conditions: "Unavailable",
  eac: "10",
  kac: "10",
  fort: "+0",
  ref: "+0",
  will: "+0",
  attack: "+0",
  weaponName: "Unavailable",
  weaponDamage: "Unavailable",
  weaponDamageType: "Unavailable",
  weaponRange: "Unavailable",
  weaponAmmo: "Unavailable",
  lastUpdatedAt: new Date("2026-04-07T21:15:00Z"),
};

describe("CharacterBotService", () => {
  let stateStore: GuildStateStore;
  let fetchPage: ReturnType<typeof vi.fn>;
  let channelContents: string[];
  let service: CharacterBotService;

  beforeEach(() => {
    stateStore = new GuildStateStore();
    fetchPage = vi.fn(async (url: string) => {
      const characterId = new URL(url).searchParams.get("characterID");
      if (characterId === "404") {
        throw new Error("missing");
      }
      return `<html><head><title>Character ${characterId} - Character Sheet</title></head></html>`;
    });
    channelContents = [];
    service = new CharacterBotService({
      config,
      stateStore,
      fetchPage,
      now: () => new Date("2026-04-07T21:15:00Z"),
    });
  });

  test("add tracks ids and creates dashboard panels", async () => {
    const target = new FakeTarget("1", "100", channelContents);

    await service.addCharacters(target, "110 245");

    const state = stateStore.get("1");
    expect([...state.tracked.keys()]).toEqual(["110", "245"]);
    expect(target.acks.at(-1)?.content).toContain("Added:");
    expect(target.panels).toHaveLength(2);
  });

  test("add reports duplicates and invalid ids", async () => {
    const target = new FakeTarget("1", "100", channelContents);

    await service.addCharacters(target, "110");
    await service.addCharacters(target, "110 abc 245");

    expect(target.acks.at(-1)?.content).toContain("Already tracked:");
    expect(target.acks.at(-1)?.content).toContain("abc");
  });

  test("commands reject the wrong config channel", async () => {
    const target = new FakeTarget("1", "999", channelContents);

    await service.listCharacters(target);

    expect(target.acks.at(-1)?.content).toContain("<#100>");
  });

  test("remove deletes existing panels and updates state", async () => {
    const target = new FakeTarget("1", "100", channelContents);
    await service.addCharacters(target, "110");

    const panel = target.panels[0]!;
    await service.removeCharacter(target, "110");

    expect(stateStore.get("1").tracked.has("110")).toBe(false);
    expect(panel.deleted).toBe(true);
    expect(target.acks.at(-1)?.content).toContain("Removed:");
  });

  test("clear removes all characters and stops tracking", async () => {
    const target = new FakeTarget("1", "100", channelContents);
    await service.addCharacters(target, "110 245");

    const state = stateStore.get("1");
    state.trackingEnabled = true;
    state.pollingController = { cancel: vi.fn() };

    await service.clearCharacters(target);

    expect(state.tracked.size).toBe(0);
    expect(state.trackingEnabled).toBe(false);
    expect(state.pollingController).toBeNull();
    expect(target.panels.every((panel) => panel.deleted)).toBe(true);
  });

  test("list reports empty registry", async () => {
    const target = new FakeTarget("1", "100", channelContents);

    await service.listCharacters(target);

    expect(target.acks.at(-1)?.content).toBe("No characters are currently being tracked.");
  });

  test("refresh updates existing panels in place and uses a temporary ack", async () => {
    const target = new FakeTarget("1", "100", channelContents);
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

    const refreshTarget = new FakeTarget("1", "200", channelContents);
    refreshTarget.panels.push(...target.panels);
    await service.refreshCharacters(refreshTarget);

    expect(target.panels[0]?.editCount).toBe(1);
    expect(target.panels[0]?.content).toContain("0/7");
    expect(target.panels[0]?.content).toContain("Prone");
    expect(refreshTarget.acks.at(-1)).toEqual(expect.objectContaining({ temporary: true }));
  });

  test("refresh rejects the wrong dashboard channel", async () => {
    const target = new FakeTarget("1", "100", channelContents);
    await service.addCharacters(target, "110");

    await service.refreshCharacters(target);

    expect(target.acks.at(-1)?.content).toContain("dashboard channel");
  });

  test("refresh marks panels stale after failed fetch and preserves last good data", async () => {
    const target = new FakeTarget("1", "100", channelContents);
    await service.addCharacters(target, "110");

    fetchPage.mockRejectedValueOnce(new Error("boom"));

    const refreshTarget = new FakeTarget("1", "200", channelContents);
    refreshTarget.panels.push(...target.panels);
    await service.refreshCharacters(refreshTarget);

    expect(target.panels[0]?.content).toContain("STALE");
    expect(stateStore.get("1").lastSnapshots.get("110")?.hp).toBe("Unavailable");
  });

  test("refresh clears stale marker after successful recovery", async () => {
    const target = new FakeTarget("1", "100", channelContents);
    await service.addCharacters(target, "110");

    fetchPage.mockRejectedValueOnce(new Error("boom"));
    const refreshTarget = new FakeTarget("1", "200", channelContents);
    refreshTarget.panels.push(...target.panels);
    await service.refreshCharacters(refreshTarget);

    fetchPage.mockResolvedValueOnce(`
      <html>
        <head><title>Character 110 - Character Sheet</title></head>
        <body>
          <input type="text" name="hp_total" value="7" />
          <input type="text" name="hp_current" value="3" />
          <input type="checkbox" checked name="conditions_off-kilter" />
        </body>
      </html>
    `);
    await service.refreshCharacters(refreshTarget);

    expect(target.panels[0]?.content).not.toContain("STALE");
    expect(target.panels[0]?.content).toContain("3/7");
    expect(target.panels[0]?.content).toContain("Off-kilter");
  });

  test("automatic refresh posts temporary change notices", async () => {
    const target = new FakeTarget("1", "100", channelContents);
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

    const result = await service.refreshTrackedCharacters("1", {
      userTriggered: false,
      announceChanges: true,
    });

    expect(result.failures).toEqual([]);
    expect(result.changeSummaries.some((summary) => summary.includes("HP changed"))).toBe(true);
    expect(target.panels[0]?.channel.sent.length).toBeGreaterThan(0);
    expect(target.panels[0]?.channel.sent.every((message) => message.deleted)).toBe(true);
  });

  test("tracking start and stop manage polling lifecycle", async () => {
    vi.useFakeTimers();
    const target = new FakeTarget("1", "100", channelContents);
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
    const target = new FakeTarget("1", "100", channelContents);

    await service.startTracking(target);

    expect(target.acks.at(-1)?.content.toLowerCase()).toContain("nothing to poll");
  });

  test("tracking start reports already ongoing when interval matches", async () => {
    const target = new FakeTarget("1", "100", channelContents);
    await service.addCharacters(target, "110");

    await service.startTracking(target, 60);
    await service.startTracking(target, 60);

    expect(target.acks.at(-1)?.content.toLowerCase()).toContain("already ongoing");
  });

  test("spec regression: add failure does not create a tracked record", async () => {
    const target = new FakeTarget("1", "100", channelContents);

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
      stateStore,
      fetchPage,
    });
    const target = new FakeTarget("1", "100", channelContents);

    await noChannelService.listCharacters(target);

    expect(target.acks.at(-1)?.content).toContain("missing channel configuration");
  });
});
