export const UNAVAILABLE = "Unavailable";

export type SnapshotField =
  | "name"
  | "initiative"
  | "hp"
  | "stamina"
  | "resolve"
  | "conditions"
  | "eac"
  | "kac"
  | "fort"
  | "ref"
  | "will"
  | "attack"
  | "weaponName"
  | "weaponDamage"
  | "weaponDamageType"
  | "weaponRange"
  | "weaponAmmo";

export interface CharacterSnapshot {
  name: string;
  initiative: string;
  hp: string;
  stamina: string;
  resolve: string;
  conditions: string;
  eac: string;
  kac: string;
  fort: string;
  ref: string;
  will: string;
  attack: string;
  weaponName: string;
  weaponDamage: string;
  weaponDamageType: string;
  weaponRange: string;
  weaponAmmo: string;
  lastUpdatedAt: Date;
}

export interface ChannelHandle {
  id: string;
  send(content: string): Promise<TemporaryMessageHandle>;
}

export interface TemporaryMessageHandle {
  id: string;
  delete(): Promise<void>;
}

export interface PanelMessageHandle extends TemporaryMessageHandle {
  channelId: string;
  channel: ChannelHandle;
  content: string;
  edit(content: string): Promise<void>;
}

export interface TrackedCharacter {
  characterId: string;
  displayName: string;
  panelMessage: PanelMessageHandle | null;
  stale: boolean;
  lastRefreshError: string | null;
}

export interface PollingController {
  cancel(): void;
}

export interface GuildState {
  tracked: Map<string, TrackedCharacter>;
  trackingEnabled: boolean;
  pollingPeriodSeconds: number;
  lastSnapshots: Map<string, CharacterSnapshot>;
  pollingController: PollingController | null;
  trackedOrder: string[];
}

export interface GuildChannels {
  configChannelId: string;
  dashboardChannelId: string;
}

export interface RuntimeConfig {
  discordBotToken: string;
  siteBaseUrl: string;
  guildChannelConfig: Record<string, GuildChannels>;
}

export interface CommandTarget {
  guildId: string | null;
  channelId: string | null;
  supportsEphemeral: boolean;
  sendAck(
    content: string,
    options?: {
      ephemeral?: boolean;
      temporary?: boolean;
    },
  ): Promise<void>;
  sendPanel(content: string): Promise<PanelMessageHandle>;
}
