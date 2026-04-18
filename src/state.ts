import type { ChannelState } from "./types.js";

const DEFAULT_POLLING_PERIOD_SECONDS = 60;

function createChannelState(): ChannelState {
  return {
    tracked: new Map(),
    trackingEnabled: false,
    pollingPeriodSeconds: DEFAULT_POLLING_PERIOD_SECONDS,
    lastSnapshots: new Map(),
    pollingController: null,
    trackedOrder: [],
    dashboardMessageId: null,
  };
}

export class ChannelStateStore {
  private readonly states = new Map<string, ChannelState>();

  get(channelId: string): ChannelState {
    const existing = this.states.get(channelId);
    if (existing) {
      return existing;
    }

    const created = createChannelState();
    this.states.set(channelId, created);
    return created;
  }

  clear(): void {
    this.states.clear();
  }
}
