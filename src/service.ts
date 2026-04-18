import { buildCharacterUrl, fetchCharacterPage, scrapeCharacterSheet } from "./fetcher.js";
import { renderCharacterPanel, diffSnapshots } from "./rendering.js";
import { GuildStateStore } from "./state.js";
import type {
  CharacterSnapshot,
  CommandTarget,
  GuildChannels,
  PanelMessageHandle,
  PollingController,
  RuntimeConfig,
  TrackedCharacter,
} from "./types.js";

interface ServiceOptions {
  config: RuntimeConfig;
  stateStore?: GuildStateStore;
  fetchPage?: (url: string) => Promise<string>;
  now?: () => Date;
}

export class CharacterBotService {
  private readonly config: RuntimeConfig;
  private readonly stateStore: GuildStateStore;
  private readonly fetchPage: (url: string) => Promise<string>;
  private readonly now: () => Date;

  constructor(options: ServiceOptions) {
    this.config = options.config;
    this.stateStore = options.stateStore ?? new GuildStateStore();
    this.fetchPage = options.fetchPage ?? fetchCharacterPage;
    this.now = options.now ?? (() => new Date());
  }

  getStateStore(): GuildStateStore {
    return this.stateStore;
  }

  async addCharacters(target: CommandTarget, rawCharacterIds: string): Promise<void> {
    const guildId = this.requireGuild(target);
    const channels = await this.requireConfiguredChannels(guildId, target);
    if (!channels) {
      return;
    }
    if (!this.isInConfigChannel(target, channels)) {
      await this.sendWrongChannelAck(target, channels.configChannelId);
      return;
    }

    const state = this.stateStore.get(guildId);
    const validIds: string[] = [];
    const invalidIds: string[] = [];
    for (const token of rawCharacterIds.split(/\s+/).filter(Boolean)) {
      if (/^\d+$/.test(token)) {
        validIds.push(token);
      } else {
        invalidIds.push(token);
      }
    }

    const added: string[] = [];
    const alreadyTracked: string[] = [];
    const failed: string[] = invalidIds.map((value) => `${value} (character IDs must be numeric)`);

    for (const characterId of validIds) {
      const existing = state.tracked.get(characterId);
      if (existing) {
        alreadyTracked.push(`${existing.displayName} (${characterId})`);
        continue;
      }

      try {
        const snapshot = await this.fetchSnapshot(characterId);
        const record: TrackedCharacter = {
          characterId,
          displayName: snapshot.name || `Character ${characterId}`,
          panelMessage: null,
          stale: false,
          lastRefreshError: null,
        };

        const panelMessage = await target.sendPanel(renderCharacterPanel(record, snapshot, false));
        record.panelMessage = panelMessage;
        state.tracked.set(characterId, record);
        state.lastSnapshots.set(characterId, snapshot);
        state.trackedOrder.push(characterId);
        added.push(`${record.displayName} (${characterId})`);
      } catch {
        failed.push(`${characterId} (page not reachable)`);
      }
    }

    await target.sendAck(this.buildSummary({ Added: added, "Already tracked": alreadyTracked, Failed: failed }), {
      ephemeral: target.supportsEphemeral,
    });
  }

  async removeCharacter(target: CommandTarget, characterId: string): Promise<void> {
    const guildId = this.requireGuild(target);
    const channels = await this.requireConfiguredChannels(guildId, target);
    if (!channels) {
      return;
    }
    if (!this.isInConfigChannel(target, channels)) {
      await this.sendWrongChannelAck(target, channels.configChannelId);
      return;
    }

    if (!/^\d+$/.test(characterId)) {
      await target.sendAck(`Failed: ${characterId} (character IDs must be numeric)`, {
        ephemeral: target.supportsEphemeral,
      });
      return;
    }

    const state = this.stateStore.get(guildId);
    const record = state.tracked.get(characterId);
    if (!record) {
      await target.sendAck(`Not tracked: ${characterId}`, { ephemeral: target.supportsEphemeral });
      return;
    }

    state.tracked.delete(characterId);
    state.lastSnapshots.delete(characterId);
    state.trackedOrder = state.trackedOrder.filter((id) => id !== characterId);
    if (record.panelMessage) {
      await record.panelMessage.delete().catch(() => undefined);
    }

    await target.sendAck(`Removed: ${record.displayName} (${characterId})`, {
      ephemeral: target.supportsEphemeral,
    });
  }

  async clearCharacters(target: CommandTarget): Promise<void> {
    const guildId = this.requireGuild(target);
    const channels = await this.requireConfiguredChannels(guildId, target);
    if (!channels) {
      return;
    }
    if (!this.isInConfigChannel(target, channels)) {
      await this.sendWrongChannelAck(target, channels.configChannelId);
      return;
    }

    const state = this.stateStore.get(guildId);
    const trackedRecords = [...state.tracked.values()];
    for (const record of trackedRecords) {
      if (record.panelMessage) {
        await record.panelMessage.delete().catch(() => undefined);
      }
    }

    state.tracked.clear();
    state.lastSnapshots.clear();
    state.trackedOrder = [];
    state.trackingEnabled = false;
    state.pollingPeriodSeconds = 60;
    state.pollingController?.cancel();
    state.pollingController = null;

    await target.sendAck(`Cleared ${trackedRecords.length} tracked character(s). Automatic tracking stopped.`, {
      ephemeral: target.supportsEphemeral,
    });
  }

  async listCharacters(target: CommandTarget): Promise<void> {
    const guildId = this.requireGuild(target);
    const channels = await this.requireConfiguredChannels(guildId, target);
    if (!channels) {
      return;
    }
    if (!this.isInConfigChannel(target, channels)) {
      await this.sendWrongChannelAck(target, channels.configChannelId);
      return;
    }

    const state = this.stateStore.get(guildId);
    if (state.trackedOrder.length === 0) {
      await target.sendAck("No characters are currently being tracked.", {
        ephemeral: target.supportsEphemeral,
      });
      return;
    }

    const entries = state.trackedOrder
      .map((characterId) => state.tracked.get(characterId))
      .filter((record): record is TrackedCharacter => Boolean(record))
      .map((record) => `${record.displayName} (${record.characterId})`);

    await target.sendAck(`Tracked characters: ${entries.join(", ")}`, { ephemeral: target.supportsEphemeral });
  }

  async refreshCharacters(target: CommandTarget): Promise<void> {
    const guildId = this.requireGuild(target);
    const channels = await this.requireConfiguredChannels(guildId, target);
    if (!channels) {
      return;
    }
    if (!this.isInDashboardChannel(target, channels)) {
      await target.sendAck(`/characters refresh only works in the dashboard channel (<#${channels.dashboardChannelId}>).`, {
        ephemeral: target.supportsEphemeral,
      });
      return;
    }

    const state = this.stateStore.get(guildId);
    if (state.trackedOrder.length === 0) {
      await target.sendAck("No characters are currently being tracked.", {
        ephemeral: target.supportsEphemeral,
        temporary: true,
      });
      return;
    }

    const result = await this.refreshTrackedCharacters(guildId, {
      userTriggered: true,
      announceChanges: false,
      target,
    });

    let status = "No changes found.";
    if (result.failures.length > 0) {
      status = `Refresh complete with failures: ${result.failures.join(", ")}`;
    } else if (result.changeSummaries.length > 0) {
      const preview = result.changeSummaries.slice(0, 3).join("; ");
      status = `Refresh complete: ${preview}${result.changeSummaries.length > 3 ? "; ..." : ""}`;
    } else if (result.panelUpdated) {
      status = "Refresh complete.";
    }

    await target.sendAck(status, { ephemeral: target.supportsEphemeral, temporary: true });
  }

  async startTracking(target: CommandTarget, pollingPeriod?: number | string): Promise<void> {
    const guildId = this.requireGuild(target);
    const channels = await this.requireConfiguredChannels(guildId, target);
    if (!channels) {
      return;
    }
    if (!this.isInConfigChannel(target, channels)) {
      await this.sendWrongChannelAck(target, channels.configChannelId);
      return;
    }

    const state = this.stateStore.get(guildId);
    let interval = state.pollingPeriodSeconds || 60;
    if (pollingPeriod !== undefined) {
      const parsed = Number.parseInt(String(pollingPeriod), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        await target.sendAck("Failed: pollingPeriod must be a positive integer number of seconds.", {
          ephemeral: target.supportsEphemeral,
        });
        return;
      }
      interval = parsed;
    }

    if (state.trackedOrder.length === 0) {
      await target.sendAck("Tracking not started: there is nothing to poll yet.", {
        ephemeral: target.supportsEphemeral,
      });
      return;
    }

    if (state.trackingEnabled) {
      if (pollingPeriod === undefined || interval === state.pollingPeriodSeconds) {
        await target.sendAck(
          `Automatic tracking is already ongoing every ${state.pollingPeriodSeconds} seconds.`,
          { ephemeral: target.supportsEphemeral },
        );
        return;
      }

      state.pollingController?.cancel();
      state.pollingPeriodSeconds = interval;
      state.trackingEnabled = true;
      state.pollingController = this.createPollingController(guildId);
      await target.sendAck(`Automatic tracking restarted with a ${interval}-second polling period.`, {
        ephemeral: target.supportsEphemeral,
      });
      return;
    }

    state.pollingPeriodSeconds = interval;
    state.trackingEnabled = true;
    state.pollingController = this.createPollingController(guildId);
    await target.sendAck(`Automatic tracking started with a ${interval}-second polling period.`, {
      ephemeral: target.supportsEphemeral,
    });
  }

  async stopTracking(target: CommandTarget): Promise<void> {
    const guildId = this.requireGuild(target);
    const channels = await this.requireConfiguredChannels(guildId, target);
    if (!channels) {
      return;
    }
    if (!this.isInConfigChannel(target, channels)) {
      await this.sendWrongChannelAck(target, channels.configChannelId);
      return;
    }

    const state = this.stateStore.get(guildId);
    state.trackingEnabled = false;
    state.pollingController?.cancel();
    state.pollingController = null;
    await target.sendAck("Automatic tracking has stopped.", { ephemeral: target.supportsEphemeral });
  }

  async refreshTrackedCharacters(
    guildId: string,
    options: {
      userTriggered: boolean;
      announceChanges: boolean;
      target?: CommandTarget;
    },
  ): Promise<{ changeSummaries: string[]; failures: string[]; panelUpdated: boolean }> {
    const state = this.stateStore.get(guildId);
    const changeSummaries: string[] = [];
    const failures: string[] = [];
    let panelUpdated = false;

    for (const characterId of state.trackedOrder) {
      const record = state.tracked.get(characterId);
      if (!record) {
        continue;
      }

      const previousSnapshot = state.lastSnapshots.get(characterId);
      try {
        const snapshot = await this.fetchSnapshot(characterId);
        record.displayName = snapshot.name || record.displayName;
        record.stale = false;
        record.lastRefreshError = null;
        state.lastSnapshots.set(characterId, snapshot);

        if (!record.panelMessage && options.target) {
          record.panelMessage = await options.target.sendPanel(renderCharacterPanel(record, snapshot, false));
          panelUpdated = true;
        } else if (record.panelMessage) {
          await record.panelMessage.edit(renderCharacterPanel(record, snapshot, false));
          panelUpdated = true;
        }

        const changes = diffSnapshots(previousSnapshot, snapshot);
        for (const change of changes) {
          const summary = `${record.displayName}: ${change}`;
          changeSummaries.push(summary);
          if (options.announceChanges && !options.userTriggered && record.panelMessage) {
            await this.sendTemporaryChannelNotice(record.panelMessage, summary);
          }
        }
      } catch (error) {
        failures.push(`${record.displayName} (${characterId})`);
        if (previousSnapshot && record.panelMessage) {
          record.stale = true;
          record.lastRefreshError = String(error);
          await record.panelMessage.edit(renderCharacterPanel(record, previousSnapshot, true)).catch(() => undefined);
          panelUpdated = true;
        }
      }
    }

    return { changeSummaries, failures, panelUpdated };
  }

  private async sendTemporaryChannelNotice(panelMessage: PanelMessageHandle, content: string): Promise<void> {
    const notice = await panelMessage.channel.send(content);
    await notice.delete().catch(() => undefined);
  }

  private createPollingController(guildId: string): PollingController {
    const state = this.stateStore.get(guildId);
    const handle = setInterval(() => {
      const freshState = this.stateStore.get(guildId);
      if (!freshState.trackingEnabled || freshState.trackedOrder.length === 0) {
        return;
      }
      void this.refreshTrackedCharacters(guildId, {
        userTriggered: false,
        announceChanges: true,
      });
    }, Math.max(1, state.pollingPeriodSeconds) * 1000);

    return {
      cancel(): void {
        clearInterval(handle);
      },
    };
  }

  private async fetchSnapshot(characterId: string): Promise<CharacterSnapshot> {
    const url = buildCharacterUrl(this.config.siteBaseUrl, characterId);
    const html = await this.fetchPage(url);
    return scrapeCharacterSheet(html, { characterId, now: this.now() });
  }

  private requireGuild(target: CommandTarget): string {
    if (!target.guildId) {
      throw new Error("This command requires a guild context.");
    }
    return target.guildId;
  }

  private async requireConfiguredChannels(guildId: string, target: CommandTarget): Promise<GuildChannels | null> {
    const channels = this.config.guildChannelConfig[guildId];
    if (!channels) {
      await target.sendAck(
        "This server is missing channel configuration. Please configure both the config and dashboard channels.",
        { ephemeral: target.supportsEphemeral },
      );
      return null;
    }
    return channels;
  }

  private isInConfigChannel(target: CommandTarget, channels: GuildChannels): boolean {
    return target.channelId === channels.configChannelId;
  }

  private isInDashboardChannel(target: CommandTarget, channels: GuildChannels): boolean {
    return target.channelId === channels.dashboardChannelId;
  }

  private async sendWrongChannelAck(target: CommandTarget, channelId: string): Promise<void> {
    await target.sendAck(`This command only works in the configured channel (<#${channelId}>).`, {
      ephemeral: target.supportsEphemeral,
    });
  }

  private buildSummary(parts: Record<"Added" | "Already tracked" | "Failed", string[]>): string {
    const orderedLabels: Array<keyof typeof parts> = ["Added", "Already tracked", "Failed"];
    const lines = orderedLabels
      .filter((label) => parts[label].length > 0)
      .map((label) => `${label}: ${parts[label].join(", ")}`);
    return lines.length > 0 ? lines.join(" | ") : "No character IDs were provided.";
  }
}
