import type { GuildState } from "./types.js";

const DEFAULT_POLLING_PERIOD_SECONDS = 60;

function createGuildState(): GuildState {
  return {
    tracked: new Map(),
    trackingEnabled: false,
    pollingPeriodSeconds: DEFAULT_POLLING_PERIOD_SECONDS,
    lastSnapshots: new Map(),
    pollingController: null,
    trackedOrder: [],
  };
}

export class GuildStateStore {
  private readonly states = new Map<string, GuildState>();

  get(guildId: string): GuildState {
    const existing = this.states.get(guildId);
    if (existing) {
      return existing;
    }

    const created = createGuildState();
    this.states.set(guildId, created);
    return created;
  }

  clear(): void {
    this.states.clear();
  }
}
