import type { DashboardMetadata, DashboardMessageSnapshot } from "./types.js";

export const DASHBOARD_MARKER = "[starfinder-character-bot dashboard v1]";

export function formatDashboardMetadata(metadata: DashboardMetadata): string {
  return [
    DASHBOARD_MARKER,
    `guildId: ${metadata.guildId}`,
    `trackedCharacterIds: ${metadata.trackedCharacterIds.join(",")}`,
    `updatedAt: ${metadata.updatedAt.toISOString()}`,
  ].join("\n");
}

export function parseDashboardMetadata(content: string): DashboardMetadata | null {
  const [marker, guildLine, trackedLine, updatedLine] = content.split(/\r?\n/, 4);
  if (marker !== DASHBOARD_MARKER) {
    return null;
  }

  const guildId = parseMetadataValue(guildLine, "guildId");
  const tracked = parseMetadataValue(trackedLine, "trackedCharacterIds");
  const updatedAtRaw = parseMetadataValue(updatedLine, "updatedAt");

  if (!guildId || tracked === null || !updatedAtRaw) {
    return null;
  }

  const trackedCharacterIds =
    tracked.trim() === ""
      ? []
      : tracked
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
  if (trackedCharacterIds.some((value) => !/^\d+$/.test(value))) {
    return null;
  }

  const updatedAt = new Date(updatedAtRaw);
  if (Number.isNaN(updatedAt.valueOf())) {
    return null;
  }

  return {
    guildId,
    trackedCharacterIds,
    updatedAt,
  };
}

export function selectAuthoritativeDashboard(
  guildId: string,
  messages: DashboardMessageSnapshot[],
): { message: DashboardMessageSnapshot; metadata: DashboardMetadata } | null {
  const candidates = messages
    .map((message) => ({ message, metadata: parseDashboardMetadata(message.content) }))
    .filter((entry): entry is { message: DashboardMessageSnapshot; metadata: DashboardMetadata } => {
      if (!entry.metadata) {
        return false;
      }
      if (entry.metadata.guildId !== guildId) {
        return false;
      }
      return true;
    })
    .sort((left, right) => right.metadata.updatedAt.valueOf() - left.metadata.updatedAt.valueOf());

  return candidates[0] ?? null;
}

function parseMetadataValue(line: string | undefined, key: string): string | null {
  const prefix = `${key}:`;
  if (!line?.startsWith(prefix)) {
    return null;
  }
  return line.slice(prefix.length).trim();
}
