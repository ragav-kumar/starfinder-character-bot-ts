import { selectAuthoritativeDashboard, formatDashboardMetadata } from "./dashboard.js";
import { buildCharacterUrl, fetchCharacterPage, scrapeCharacterSheet } from "./fetcher.js";
import { logException } from "./logging.js";
import { diffSnapshots, renderCompositeDashboard } from "./rendering.js";
import { ChannelStateStore } from "./state.js";
import type {
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
  stateStore?: ChannelStateStore;
  fetchPage?: (url: string) => Promise<string>;
  now?: () => Date;
}

interface ChannelContext {
  guildId: string;
  channelId: string;
}

export class CharacterBotService {
  private readonly config: RuntimeConfig;
  private readonly dashboardStore: DashboardStore;
  private readonly stateStore: ChannelStateStore;
  private readonly fetchPage: (url: string) => Promise<string>;
  private readonly now: () => Date;

  constructor(options: ServiceOptions) {
    this.config = options.config;
    this.dashboardStore = options.dashboardStore;
    this.stateStore = options.stateStore ?? new ChannelStateStore();
    this.fetchPage = options.fetchPage ?? fetchCharacterPage;
    this.now = options.now ?? (() => new Date());
  }

  getStateStore(): ChannelStateStore {
    return this.stateStore;
  }

  async addCharacters(target: CommandTarget, rawCharacterIds: string): Promise<void> {
    const context = this.requireChannelContext(target);
    const state = await this.recoverDashboardState(context);
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
        };

        state.tracked.set(characterId, record);
        state.lastSnapshots.set(characterId, snapshot);
        state.trackedOrder.push(characterId);
        added.push(`${record.displayName} (${characterId})`);
      } catch (error) {
        logException("CharacterBotService.addCharacters", error, {
          guildId: context.guildId,
          channelId: context.channelId,
          characterId,
          url: buildCharacterUrl(this.config.siteBaseUrl, characterId),
        });
        failed.push(`${characterId} (page not reachable)`);
      }
    }

    if (added.length > 0 || state.dashboardMessageId === null) {
      await this.syncDashboard(context);
    }

    await target.sendAck(this.buildSummary({ Added: added, "Already tracked": alreadyTracked, Failed: failed }), {
      ephemeral: target.supportsEphemeral,
    });
  }

  async removeCharacter(target: CommandTarget, characterId: string): Promise<void> {
    const context = this.requireChannelContext(target);
    if (!/^\d+$/.test(characterId)) {
      await target.sendAck(`Failed: ${characterId} (character IDs must be numeric)`, {
        ephemeral: target.supportsEphemeral,
      });
      return;
    }

    const state = await this.recoverDashboardState(context);
    const record = state.tracked.get(characterId);
    if (!record) {
      await target.sendAck(`Not tracked: ${characterId}`, { ephemeral: target.supportsEphemeral });
      return;
    }

    state.tracked.delete(characterId);
    state.lastSnapshots.delete(characterId);
    state.trackedOrder = state.trackedOrder.filter((id) => id !== characterId);

    await this.syncDashboard(context);

    await target.sendAck(`Removed: ${record.displayName} (${characterId})`, {
      ephemeral: target.supportsEphemeral,
    });
  }

  async clearCharacters(target: CommandTarget): Promise<void> {
    const context = this.requireChannelContext(target);
    const state = await this.recoverDashboardState(context);
    const trackedCount = state.tracked.size;

    state.tracked.clear();
    state.lastSnapshots.clear();
    state.trackedOrder = [];
    state.trackingEnabled = false;
    state.pollingPeriodSeconds = 60;
    state.pollingController?.cancel();
    state.pollingController = null;

    await this.syncDashboard(context);

    await target.sendAck(`Cleared ${trackedCount} tracked character(s). Automatic tracking stopped.`, {
      ephemeral: target.supportsEphemeral,
    });
  }

  async listCharacters(target: CommandTarget): Promise<void> {
    const context = this.requireChannelContext(target);
    const state = await this.recoverDashboardState(context);
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
    const context = this.requireChannelContext(target);
    const state = await this.recoverDashboardState(context);
    if (state.trackedOrder.length === 0) {
      await target.sendAck("No characters are currently being tracked.", {
        ephemeral: target.supportsEphemeral,
        temporary: true,
      });
      return;
    }

    const result = await this.refreshTrackedCharacters(context, {
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
    const context = this.requireChannelContext(target);
    const state = await this.recoverDashboardState(context);
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
      state.pollingController = this.createPollingController(context);
      await target.sendAck(`Automatic tracking restarted with a ${interval}-second polling period.`, {
        ephemeral: target.supportsEphemeral,
      });
      return;
    }

    state.pollingPeriodSeconds = interval;
    state.trackingEnabled = true;
    state.pollingController = this.createPollingController(context);
    await target.sendAck(`Automatic tracking started with a ${interval}-second polling period.`, {
      ephemeral: target.supportsEphemeral,
    });
  }

  async stopTracking(target: CommandTarget): Promise<void> {
    const context = this.requireChannelContext(target);
    const state = this.stateStore.get(context.channelId);
    state.trackingEnabled = false;
    state.pollingController?.cancel();
    state.pollingController = null;
    await target.sendAck("Automatic tracking has stopped.", { ephemeral: target.supportsEphemeral });
  }

  async refreshTrackedCharacters(
    context: ChannelContext,
    options: {
      userTriggered: boolean;
      announceChanges: boolean;
    },
  ): Promise<{ changeSummaries: string[]; failures: string[]; dashboardUpdated: boolean }> {
    void options;
    const state = await this.recoverDashboardState(context);
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
        state.lastSnapshots.set(characterId, snapshot);

        const changes = diffSnapshots(previousSnapshot, snapshot);
        for (const change of changes) {
          changeSummaries.push(`${record.displayName}: ${change}`);
        }
      } catch (error) {
        logException("CharacterBotService.refreshTrackedCharacters", error, {
          guildId: context.guildId,
          channelId: context.channelId,
          characterId,
          url: buildCharacterUrl(this.config.siteBaseUrl, characterId),
        });
        failures.push(`${record.displayName} (${characterId})`);
        record.stale = true;
        record.lastRefreshError = String(error);
      }
    }

    await this.syncDashboard(context);

    return {
      changeSummaries,
      failures,
      dashboardUpdated: true,
    };
  }

  private async recoverDashboardState(context: ChannelContext) {
    const state = this.stateStore.get(context.channelId);

    const needsRecovery =
      state.dashboardMessageId === null ||
      (state.tracked.size === 0 && state.trackedOrder.length === 0 && state.lastSnapshots.size === 0);
    if (!needsRecovery) {
      return state;
    }

    const messages = await this.dashboardStore.listChannelMessages(context.channelId);
    const authoritative = selectAuthoritativeDashboard(context.guildId, context.channelId, messages);
    if (!authoritative) {
      state.dashboardMessageId = null;
      state.tracked.clear();
      state.trackedOrder = [];
      state.lastSnapshots.clear();
      return state;
    }

    const { message, metadata } = authoritative;
    state.dashboardMessageId = message.id;
    state.trackedOrder = [...metadata.trackedCharacterIds];

    const recoveredTracked = new Map<string, TrackedCharacter>();
    for (const characterId of metadata.trackedCharacterIds) {
      const existing = state.tracked.get(characterId);
      recoveredTracked.set(characterId, {
        characterId,
        displayName: existing?.displayName ?? state.lastSnapshots.get(characterId)?.name ?? `Character ${characterId}`,
        stale: existing?.stale ?? false,
        lastRefreshError: existing?.lastRefreshError ?? null,
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

  private async syncDashboard(context: ChannelContext): Promise<void> {
    const state = this.stateStore.get(context.channelId);
    const metadata: DashboardMetadata = {
      guildId: context.guildId,
      channelId: context.channelId,
      trackedCharacterIds: [...state.trackedOrder],
      updatedAt: this.now(),
    };
    const humanReadable = this.buildDashboardBody(state);
    const content = `${formatDashboardMetadata(metadata)}\n\n${humanReadable}`;
    const attachments = await this.buildDashboardAttachments(state);

    const result =
      state.dashboardMessageId === null
        ? await this.dashboardStore.createMessage(context.channelId, content, attachments)
        : await this.dashboardStore.editMessage(context.channelId, state.dashboardMessageId, content, attachments);

    state.dashboardMessageId = result.id;
  }

  private async buildDashboardAttachments(state: ReturnType<ChannelStateStore["get"]>): Promise<DashboardAttachment[]> {
    if (state.trackedOrder.length === 0) {
      return [];
    }

    const cards = state.trackedOrder
      .map((characterId) => {
        const record = state.tracked.get(characterId);
        const snapshot = state.lastSnapshots.get(characterId);
        if (!record || !snapshot) {
          return null;
        }

        return {
          characterId,
          displayName: record.displayName,
          snapshot,
          stale: record.stale,
        };
      })
      .filter(
        (
          card,
        ): card is {
          characterId: string;
          displayName: string;
          snapshot: CharacterSnapshot;
          stale: boolean;
        } => Boolean(card),
      );

    if (cards.length === 0) {
      return [];
    }

    return [await renderCompositeDashboard(cards)];
  }

  private buildDashboardBody(state: ReturnType<ChannelStateStore["get"]>): string {
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

  private createPollingController(context: ChannelContext): PollingController {
    const state = this.stateStore.get(context.channelId);
    const handle = setInterval(() => {
      const freshState = this.stateStore.get(context.channelId);
      if (!freshState.trackingEnabled || freshState.trackedOrder.length === 0) {
        return;
      }
      void this.refreshTrackedCharacters(context, {
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

  private requireChannelContext(target: CommandTarget): ChannelContext {
    if (!target.guildId) {
      throw new Error("This command requires a guild context.");
    }
    if (!target.channelId) {
      throw new Error("This command requires a channel context.");
    }
    return {
      guildId: target.guildId,
      channelId: target.channelId,
    };
  }

  private buildSummary(parts: Record<"Added" | "Already tracked" | "Failed", string[]>): string {
    const orderedLabels: Array<keyof typeof parts> = ["Added", "Already tracked", "Failed"];
    const lines = orderedLabels
      .filter((label) => parts[label].length > 0)
      .map((label) => `${label}: ${parts[label].join(", ")}`);
    return lines.length > 0 ? lines.join(" | ") : "No character IDs were provided.";
  }
}
