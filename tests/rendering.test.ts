import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import {
  CARD_HEIGHT,
  CARD_WIDTH,
  buildCharacterCardTemplateData,
  formatTimestamp,
  populateCharacterCardTemplate,
  renderCharacterCard,
  renderCharacterCardMarkup,
} from "../src/rendering.js";
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
  test("builds template data with documented fallback behavior", () => {
    const data = buildCharacterCardTemplateData("Paul-Paul Atreides", "110", {
      ...snapshot,
      conditions: "",
      weaponAmmo: " ",
    }, false);

    expect("cardWidth" in data).toBe(false);
    expect("cardBackground" in data).toBe(false);
    expect(data.status).toBe("CURRENT");
    expect("isStale" in data).toBe(false);
    expect(data.conditionsDisplay).toBe("None");
    expect(data.weaponAmmo).toBe("Unavailable");
    expect(data.lastUpdated).toBe(formatTimestamp(snapshot.lastUpdatedAt));
  });

  test("renders template markup with escaped placeholder values", async () => {
    const markup = await renderCharacterCardMarkup(buildCharacterCardTemplateData("Paul <Paul>", "110", {
      ...snapshot,
      weaponName: "<Laser Pistol>",
    }, false));

    expect(markup).not.toContain("{{");
    expect(markup).toContain("Paul &lt;Paul&gt;");
    expect(markup).toContain("&lt;Laser Pistol&gt;");
    expect(markup).toContain("CURRENT");
  });

  test("renders a png attachment with configured dimensions and stale-state differences", async () => {
    const fresh = await renderCharacterCard("110", "Paul-Paul Atreides", snapshot, false);
    const stale = await renderCharacterCard("110", "Paul-Paul Atreides", snapshot, true);

    expect(fresh.filename).toBe("character-110.png");
    expect(fresh.contentType).toBe("image/png");
    expect(fresh.data.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(readPngWidth(fresh.data)).toBe(CARD_WIDTH);
    expect(readPngHeight(fresh.data)).toBe(CARD_HEIGHT);
    expect(stale.data.equals(fresh.data)).toBe(false);
  });

  test("changes in placeholder-backed values change the populated template markup", async () => {
    const original = await renderCharacterCardMarkup(buildCharacterCardTemplateData("Paul-Paul Atreides", "110", snapshot, false));
    const changed = await renderCharacterCardMarkup(buildCharacterCardTemplateData("Paul-Paul Atreides", "110", {
      ...snapshot,
      weaponName: "Plasma Bolter",
    }, false));

    expect(changed).not.toBe(original);
    expect(changed).toContain("Plasma Bolter");
  });

  test("template renders a static layout with status text substitution", async () => {
    const freshMarkup = await renderCharacterCardMarkup(buildCharacterCardTemplateData("Paul-Paul Atreides", "110", snapshot, false));
    const staleMarkup = await renderCharacterCardMarkup(buildCharacterCardTemplateData("Paul-Paul Atreides", "110", snapshot, true));

    expect(freshMarkup).toContain("CURRENT");
    expect(staleMarkup).toContain("STALE");
    expect(freshMarkup).not.toBe(staleMarkup);
  });

  test("skips missing template ids", async () => {
    const template = await readFile(new URL("../templates/character-card.html", import.meta.url), "utf8");
    const templateMissingStatus = template.replace('id="status"', 'data-field="status"');

    expect(() =>
      populateCharacterCardTemplate(
        templateMissingStatus,
        buildCharacterCardTemplateData("Paul-Paul Atreides", "110", snapshot, false),
      ),
    ).not.toThrow();
  });
});

function readPngWidth(buffer: Buffer): number {
  return buffer.readUInt32BE(16);
}

function readPngHeight(buffer: Buffer): number {
  return buffer.readUInt32BE(20);
}
