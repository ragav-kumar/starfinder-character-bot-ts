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

export interface BotChannelConfig {
  botChannelId: string;
}

export interface RuntimeConfig {
  discordBotToken: string;
  siteBaseUrl: string;
  guildChannelConfig: Record<string, BotChannelConfig>;
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
}

export interface TemporaryMessageHandle {
  id: string;
  delete(): Promise<void>;
}

export interface PollingController {
  cancel(): void;
}

export interface DashboardMetadata {
  guildId: string;
  trackedCharacterIds: string[];
  updatedAt: Date;
}

export interface ExistingDashboardAttachment {
  kind: "existing";
  id: string;
  filename: string;
  characterId?: string;
}

export interface RenderedDashboardAttachment {
  kind: "rendered";
  characterId: string;
  filename: string;
  contentType: "image/png";
  data: Buffer;
}

export type DashboardAttachment = ExistingDashboardAttachment | RenderedDashboardAttachment;

export interface DashboardMessageSnapshot {
  id: string;
  channelId: string;
  content: string;
  attachments: ExistingDashboardAttachment[];
  createdAt: Date;
}

export interface DashboardStore {
  listChannelMessages(channelId: string): Promise<DashboardMessageSnapshot[]>;
  createMessage(channelId: string, content: string, attachments: DashboardAttachment[]): Promise<DashboardMessageSnapshot>;
  editMessage(
    channelId: string,
    messageId: string,
    content: string,
    attachments: DashboardAttachment[],
  ): Promise<DashboardMessageSnapshot>;
}

export interface TrackedCharacter {
  characterId: string;
  displayName: string;
  stale: boolean;
  lastRefreshError: string | null;
  dashboardAttachment: DashboardAttachment | null;
}

export interface GuildState {
  tracked: Map<string, TrackedCharacter>;
  trackingEnabled: boolean;
  pollingPeriodSeconds: number;
  lastSnapshots: Map<string, CharacterSnapshot>;
  pollingController: PollingController | null;
  trackedOrder: string[];
  dashboardMessageId: string | null;
}
