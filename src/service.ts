import { selectAuthoritativeDashboard, formatDashboardMetadata } from "./dashboard.js";
import { buildCharacterUrl, fetchCharacterPage, scrapeCharacterSheet } from "./fetcher.js";
import { renderCharacterCard, diffSnapshots } from "./rendering.js";
import { GuildStateStore } from "./state.js";
import type {
  BotChannelConfig,
  CharacterSnapshot,
  CommandTarget,
  DashboardAttachment,
  DashboardMetadata,
  DashboardStore,
  PollingController,
  RuntimeConfig,
  TrackedCharacter,
} from "./types.js";

interface ServiceOptions {
  config: RuntimeConfig;
  dashboardStore: DashboardStore;
  stateStore?: GuildStateStore;
  fetchPage?: (url: string) => Promise<string>;
  now?: () => Date;
}

export class CharacterBotService {
  private readonly config: RuntimeConfig;
  private readonly dashboardStore: DashboardStore;
  private readonly stateStore: GuildStateStore;
  private readonly fetchPage: (url: string) => Promise<string>;
  private readonly now: () => Date;

  constructor(options: ServiceOptions) {
    this.config = options.config;
    this.dashboardStore = options.dashboardStore;
    this.stateStore = options.stateStore ?? new GuildStateStore();
    this.fetchPage = options.fetchPage ?? fetchCharacterPage;
    this.now = options.now ?? (() => new Date());
  }

  getStateStore(): GuildStateStore {
    return this.stateStore;
  }

  async recoverConfiguredGuilds(): Promise<void> {
    for (const guildId of Object.keys(this.config.guildChannelConfig)) {
      await this.recoverDashboardState(guildId);
    }
  }

  async addCharacters(target: CommandTarget, rawCharacterIds: string): Promise<void> {
    const guildId = this.requireGuild(target);
    const channelConfig = await this.requireConfiguredChannel(guildId, target);
    if (!channelConfig) {
      return;
    }
    if (!this.isInBotChannel(target, channelConfig)) {
      await this.sendWrongChannelAck(target, channelConfig.botChannelId);
      return;
    }

    const state = await this.recoverDashboardState(guildId);
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
          stale: false,
          lastRefreshError: null,
          dashboardAttachment: renderCharacterCard(characterId, snapshot.name || `Character ${characterId}`, snapshot, false),
        };

        state.tracked.set(characterId, record);
        state.lastSnapshots.set(characterId, snapshot);
        state.trackedOrder.push(characterId);
        added.push(`${record.displayName} (${characterId})`);
      } catch {
        failed.push(`${characterId} (page not reachable)`);
      }
    }

    if (added.length > 0 || state.dashboardMessageId === null) {
      await this.syncDashboard(guildId);
    }

    await target.sendAck(this.buildSummary({ Added: added, "Already tracked": alreadyTracked, Failed: failed }), {
      ephemeral: target.supportsEphemeral,
    });
  }

  async removeCharacter(target: CommandTarget, characterId: string): Promise<void> {
    const guildId = this.requireGuild(target);
    const channelConfig = await this.requireConfiguredChannel(guildId, target);
    if (!channelConfig) {
      return;
    }
    if (!this.isInBotChannel(target, channelConfig)) {
      await this.sendWrongChannelAck(target, channelConfig.botChannelId);
      return;
    }

    if (!/^\d+$/.test(characterId)) {
      await target.sendAck(`Failed: ${characterId} (character IDs must be numeric)`, {
        ephemeral: target.supportsEphemeral,
      });
      return;
    }

    const state = await this.recoverDashboardState(guildId);
    const record = state.tracked.get(characterId);
    if (!record) {
      await target.sendAck(`Not tracked: ${characterId}`, { ephemeral: target.supportsEphemeral });
      return;
    }

    state.tracked.delete(characterId);
    state.lastSnapshots.delete(characterId);
    state.trackedOrder = state.trackedOrder.filter((id) => id !== characterId);

    await this.syncDashboard(guildId);

    await target.sendAck(`Removed: ${record.displayName} (${characterId})`, {
      ephemeral: target.supportsEphemeral,
    });
  }

  async clearCharacters(target: CommandTarget): Promise<void> {
    const guildId = this.requireGuild(target);
    const channelConfig = await this.requireConfiguredChannel(guildId, target);
    if (!channelConfig) {
      return;
    }
    if (!this.isInBotChannel(target, channelConfig)) {
      await this.sendWrongChannelAck(target, channelConfig.botChannelId);
      return;
    }

    const state = await this.recoverDashboardState(guildId);
    const trackedCount = state.tracked.size;

    state.tracked.clear();
    state.lastSnapshots.clear();
    state.trackedOrder = [];
    state.trackingEnabled = false;
    state.pollingPeriodSeconds = 60;
    state.pollingController?.cancel();
    state.pollingController = null;

    await this.syncDashboard(guildId);

    await target.sendAck(`Cleared ${trackedCount} tracked character(s). Automatic tracking stopped.`, {
      ephemeral: target.supportsEphemeral,
    });
  }

  async listCharacters(target: CommandTarget): Promise<void> {
    const guildId = this.requireGuild(target);
    const channelConfig = await this.requireConfiguredChannel(guildId, target);
    if (!channelConfig) {
      return;
    }
    if (!this.isInBotChannel(target, channelConfig)) {
      await this.sendWrongChannelAck(target, channelConfig.botChannelId);
      return;
    }

    const state = await this.recoverDashboardState(guildId);
    if (state.trackedOrder.length === 0) {
      await target.sendAck("No characters are currently being tracked.", {
        ephemeral: target.supportsEphemeral,
      });
      return;
    }

    const entries = state.trackedOrder
      .map((trackedId) => state.tracked.get(trackedId))
      .filter((record): record is TrackedCharacter => Boolean(record))
      .map((record) => `${record.displayName} (${record.characterId})`);

    await target.sendAck(`Tracked characters: ${entries.join(", ")}`, { ephemeral: target.supportsEphemeral });
  }

  async refreshCharacters(target: CommandTarget): Promise<void> {
    const guildId = this.requireGuild(target);
    const channelConfig = await this.requireConfiguredChannel(guildId, target);
    if (!channelConfig) {
      return;
    }
    if (!this.isInBotChannel(target, channelConfig)) {
      await this.sendWrongChannelAck(target, channelConfig.botChannelId);
      return;
    }

    const state = await this.recoverDashboardState(guildId);
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
    });

    let status = "No changes found.";
    if (result.failures.length > 0) {
      status = `Refresh complete with failures: ${result.failures.join(", ")}`;
    } else if (result.changeSummaries.length > 0) {
      const preview = result.changeSummaries.slice(0, 3).join("; ");
      status = `Refresh complete: ${preview}${result.changeSummaries.length > 3 ? "; ..." : ""}`;
    } else if (result.dashboardUpdated) {
      status = "Refresh complete.";
    }

    await target.sendAck(status, { ephemeral: target.supportsEphemeral, temporary: true });
  }

  async startTracking(target: CommandTarget, pollingPeriod?: number | string): Promise<void> {
    const guildId = this.requireGuild(target);
    const channelConfig = await this.requireConfiguredChannel(guildId, target);
    if (!channelConfig) {
      return;
    }
    if (!this.isInBotChannel(target, channelConfig)) {
      await this.sendWrongChannelAck(target, channelConfig.botChannelId);
      return;
    }

    const state = await this.recoverDashboardState(guildId);
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
    const channelConfig = await this.requireConfiguredChannel(guildId, target);
    if (!channelConfig) {
      return;
    }
    if (!this.isInBotChannel(target, channelConfig)) {
      await this.sendWrongChannelAck(target, channelConfig.botChannelId);
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
    },
  ): Promise<{ changeSummaries: string[]; failures: string[]; dashboardUpdated: boolean }> {
    void options;
    const state = await this.recoverDashboardState(guildId);
    const changeSummaries: string[] = [];
    const failures: string[] = [];

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
        record.dashboardAttachment = renderCharacterCard(characterId, record.displayName, snapshot, false);
        state.lastSnapshots.set(characterId, snapshot);

        const changes = diffSnapshots(previousSnapshot, snapshot);
        for (const change of changes) {
          changeSummaries.push(`${record.displayName}: ${change}`);
        }
      } catch (error) {
        failures.push(`${record.displayName} (${characterId})`);
        record.stale = true;
        record.lastRefreshError = String(error);
        if (previousSnapshot) {
          record.dashboardAttachment = renderCharacterCard(characterId, record.displayName, previousSnapshot, true);
        }
      }
    }

    await this.syncDashboard(guildId);

    return {
      changeSummaries,
      failures,
      dashboardUpdated: true,
    };
  }

  private async recoverDashboardState(guildId: string) {
    const state = this.stateStore.get(guildId);
    const channelConfig = this.config.guildChannelConfig[guildId];
    if (!channelConfig) {
      return state;
    }

    const needsRecovery =
      state.dashboardMessageId === null ||
      (state.tracked.size === 0 && state.trackedOrder.length === 0 && state.lastSnapshots.size === 0);
    if (!needsRecovery) {
      return state;
    }

    const messages = await this.dashboardStore.listChannelMessages(channelConfig.botChannelId);
    const authoritative = selectAuthoritativeDashboard(guildId, messages);
    if (!authoritative) {
      state.dashboardMessageId = null;
      state.tracked.clear();
      state.trackedOrder = [];
      return state;
    }

    const { message, metadata } = authoritative;
    state.dashboardMessageId = message.id;
    state.trackedOrder = [...metadata.trackedCharacterIds];

    const recoveredTracked = new Map<string, TrackedCharacter>();
    for (const [index, characterId] of metadata.trackedCharacterIds.entries()) {
      const existing = state.tracked.get(characterId);
      const attachment = message.attachments[index] ?? null;
      recoveredTracked.set(characterId, {
        characterId,
        displayName: existing?.displayName ?? state.lastSnapshots.get(characterId)?.name ?? `Character ${characterId}`,
        stale: existing?.stale ?? false,
        lastRefreshError: existing?.lastRefreshError ?? null,
        dashboardAttachment: existing?.dashboardAttachment ?? attachment,
      });
    }

    state.tracked = recoveredTracked;
    for (const characterId of [...state.lastSnapshots.keys()]) {
      if (!recoveredTracked.has(characterId)) {
        state.lastSnapshots.delete(characterId);
      }
    }

    return state;
  }

  private async syncDashboard(guildId: string): Promise<void> {
    const state = this.stateStore.get(guildId);
    const channelConfig = this.config.guildChannelConfig[guildId];
    if (!channelConfig) {
      throw new Error("This server is missing bot channel configuration.");
    }

    const metadata: DashboardMetadata = {
      guildId,
      trackedCharacterIds: [...state.trackedOrder],
      updatedAt: this.now(),
    };
    const humanReadable = this.buildDashboardBody(state);
    const content = `${formatDashboardMetadata(metadata)}\n\n${humanReadable}`;
    const attachments = this.buildDashboardAttachments(state);

    const result =
      state.dashboardMessageId === null
        ? await this.dashboardStore.createMessage(channelConfig.botChannelId, content, attachments)
        : await this.dashboardStore.editMessage(channelConfig.botChannelId, state.dashboardMessageId, content, attachments);

    state.dashboardMessageId = result.id;
  }

  private buildDashboardAttachments(state: ReturnType<GuildStateStore["get"]>): DashboardAttachment[] {
    return state.trackedOrder
      .map((characterId) => state.tracked.get(characterId)?.dashboardAttachment ?? null)
      .filter((attachment): attachment is DashboardAttachment => Boolean(attachment));
  }

  private buildDashboardBody(state: ReturnType<GuildStateStore["get"]>): string {
    if (state.trackedOrder.length === 0) {
      return "No characters are currently tracked.";
    }

    const trackingStatus = state.trackingEnabled
      ? `Automatic tracking: on (${state.pollingPeriodSeconds}s)`
      : "Automatic tracking: off";
    const tracked = state.trackedOrder
      .map((characterId) => state.tracked.get(characterId))
      .filter((record): record is TrackedCharacter => Boolean(record))
      .map((record) => `${record.displayName} (${record.characterId})${record.stale ? " [STALE]" : ""}`);

    return [trackingStatus, `Tracked characters: ${tracked.join(", ")}`].join("\n");
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
        announceChanges: false,
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

  private async requireConfiguredChannel(guildId: string, target: CommandTarget): Promise<BotChannelConfig | null> {
    const channelConfig = this.config.guildChannelConfig[guildId];
    if (!channelConfig) {
      await target.sendAck("This server is missing bot channel configuration. Please configure botChannelId.", {
        ephemeral: target.supportsEphemeral,
      });
      return null;
    }
    return channelConfig;
  }

  private isInBotChannel(target: CommandTarget, channelConfig: BotChannelConfig): boolean {
    return target.channelId === channelConfig.botChannelId;
  }

  private async sendWrongChannelAck(target: CommandTarget, channelId: string): Promise<void> {
    await target.sendAck(`This command only works in the configured bot channel (<#${channelId}>).`, {
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
