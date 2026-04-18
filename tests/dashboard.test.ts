import { describe, expect, test } from "vitest";

import { DASHBOARD_MARKER, formatDashboardMetadata, parseDashboardMetadata, selectAuthoritativeDashboard } from "../src/dashboard.js";
import type { DashboardMessageSnapshot } from "../src/types.js";

function message(id: string, content: string): DashboardMessageSnapshot {
  return {
    id,
    channelId: "200",
    content,
    attachments: [],
    createdAt: new Date("2026-04-17T18:00:00Z"),
  };
}

describe("dashboard metadata", () => {
  test("parses valid metadata", () => {
    const metadata = parseDashboardMetadata(
      formatDashboardMetadata({
        guildId: "1",
        trackedCharacterIds: ["110", "245"],
        updatedAt: new Date("2026-04-17T18:00:00Z"),
      }),
    );

    expect(metadata).toEqual({
      guildId: "1",
      trackedCharacterIds: ["110", "245"],
      updatedAt: new Date("2026-04-17T18:00:00.000Z"),
    });
  });

  test("rejects malformed metadata", () => {
    expect(
      parseDashboardMetadata(`${DASHBOARD_MARKER}
guildId: 1
trackedCharacterIds: abc
updatedAt: 2026-04-17T18:00:00Z`),
    ).toBeNull();
  });

  test("selects the most recently updated valid dashboard", () => {
    const older = message(
      "1",
      formatDashboardMetadata({
        guildId: "guild",
        trackedCharacterIds: ["110"],
        updatedAt: new Date("2026-04-17T18:00:00Z"),
      }),
    );
    const newer = message(
      "2",
      formatDashboardMetadata({
        guildId: "guild",
        trackedCharacterIds: ["245"],
        updatedAt: new Date("2026-04-17T19:00:00Z"),
      }),
    );
    const wrongGuild = message(
      "3",
      formatDashboardMetadata({
        guildId: "other",
        trackedCharacterIds: ["999"],
        updatedAt: new Date("2026-04-17T20:00:00Z"),
      }),
    );

    const selected = selectAuthoritativeDashboard("guild", [older, newer, wrongGuild]);

    expect(selected?.message.id).toBe("2");
    expect(selected?.metadata.trackedCharacterIds).toEqual(["245"]);
  });
});
