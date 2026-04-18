import { describe, expect, test } from "vitest";

import { buildCharacterCardLines, renderCharacterCard } from "../src/rendering.js";
import type { CharacterSnapshot } from "../src/types.js";

const snapshot: CharacterSnapshot = {
  name: "Paul-Paul Atreides",
  initiative: "+4",
  hp: "7/7",
  stamina: "5/5",
  resolve: "5/5",
  conditions: "Off-kilter",
  eac: "15",
  kac: "16",
  fort: "+0",
  ref: "+6",
  will: "+0",
  attack: "+4",
  weaponName: "Laser Pistol",
  weaponDamage: "1d4 + LEV",
  weaponDamageType: "Burn 1d4",
  weaponRange: "80 ft",
  weaponAmmo: "52 / 1-20",
  lastUpdatedAt: new Date("2026-04-07T21:15:00Z"),
};

describe("rendering", () => {
  test("builds readable card lines", () => {
    const lines = buildCharacterCardLines("Paul-Paul Atreides", "110", snapshot, false);

    expect(lines[0]).toBe("Paul-Paul Atreides");
    expect(lines.some((line) => line.includes("Weapon"))).toBe(true);
    expect(lines.some((line) => line.includes("Last updated"))).toBe(true);
  });

  test("renders a png attachment and stale state changes output", () => {
    const fresh = renderCharacterCard("110", "Paul-Paul Atreides", snapshot, false);
    const stale = renderCharacterCard("110", "Paul-Paul Atreides", snapshot, true);

    expect(fresh.filename).toBe("character-110.png");
    expect(fresh.contentType).toBe("image/png");
    expect(fresh.data.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(stale.data.equals(fresh.data)).toBe(false);
  });
});
