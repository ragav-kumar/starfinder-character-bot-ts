import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import {
  buildCharacterCardTemplateData,
  CARD_HEIGHT,
  CARD_WIDTH,
  DASHBOARD_COLUMNS,
  DASHBOARD_FILENAME,
  formatTimestamp,
  getCompositeDashboardDimensions,
  populateCharacterCardTemplate,
  renderCharacterCard,
  renderCharacterCardMarkup,
  renderCompositeDashboard,
} from "../src/rendering.js";
import type { CharacterSnapshot } from "../src/types.js";

const snapshot: CharacterSnapshot = {
  name: "Paul-Paul Atreides",
  characterClass: "Precog",
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
  weaponName: "Laser Pistol",
  weaponLevel: "1",
  weaponAttack: "+4",
  weaponDamage: "1d4 + LEV",
  weaponCritical: "Burn 1d4",
  weaponDamageType: "F",
  weaponRange: "80 ft",
  weaponAmmo: "52 / 1-20",
  weaponSpecial: "-",
  lastUpdatedAt: new Date("2026-04-07T21:15:00Z"),
};

describe("rendering", () => {
  test("builds template data with weapon placeholder fallback behavior", () => {
    const data = buildCharacterCardTemplateData("Paul-Paul Atreides", "110", {
      ...snapshot,
      conditions: "",
      weaponAmmo: " ",
      weaponCritical: "Unavailable",
    }, false);

    expect("cardWidth" in data).toBe(false);
    expect("cardBackground" in data).toBe(false);
    expect(data.status).toBe("CURRENT");
    expect(data.characterClass).toBe("Precog");
    expect(data.hp).toBe("7 / 7");
    expect(data.stamina).toBe("5 / 5");
    expect(data.resolve).toBe("5 / 5");
    expect("isStale" in data).toBe(false);
    expect(data.conditionsDisplay).toBe("None");
    expect(data.weaponAmmo).toBe("-");
    expect(data.weaponCritical).toBe("-");
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

  test("exposes renamed weapon fields in template data", () => {
    const data = buildCharacterCardTemplateData("Paul-Paul Atreides", "110", snapshot, false);

    expect(data.weaponAttack).toBe("+4");
    expect(data.weaponCritical).toBe("Burn 1d4");
    expect(data.weaponDamageType).toBe("F");
  });

  test("keeps weapon name unavailable while other missing weapon fields render as dashes", () => {
    const data = buildCharacterCardTemplateData("Paul-Paul Atreides", "110", {
      ...snapshot,
      weaponName: "Unavailable",
      weaponLevel: "Unavailable",
      weaponDamage: "Unavailable",
      weaponDamageType: "Unavailable",
      weaponRange: " ",
    }, false);

    expect(data.weaponName).toBe("Unavailable");
    expect(data.weaponLevel).toBe("-");
    expect(data.weaponRange).toBe("-");
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

  test("renders the character card through satori", async () => {
    const attachment = await renderCharacterCard("110", "Paul-Paul Atreides", snapshot, false);

    expect(attachment.kind).toBe("rendered");
    expect(attachment.filename).toBe("character-110.png");
    expect(attachment.contentType).toBe("image/png");
    expect(attachment.data.length).toBeGreaterThan(0);
  });

  test("renders a single-card composite dashboard", async () => {
    const attachment = await renderCompositeDashboard([
      { characterId: "110", displayName: "Paul-Paul Atreides", snapshot, stale: false },
    ]);

    expect(attachment.kind).toBe("rendered");
    expect(attachment.filename).toBe(DASHBOARD_FILENAME);
    expect(attachment.contentType).toBe("image/png");
    expect(attachment.data.length).toBeGreaterThan(0);
  });

  test("keeps composite dimensions to one row for small rosters", () => {
    expect(getCompositeDashboardDimensions(2)).toEqual({
      columns: 2,
      rows: 1,
      width: 24 * 2 + CARD_WIDTH * 2 + 24,
      height: 24 * 2 + CARD_HEIGHT,
    });
  });

  test("wraps composite dashboards after three columns", () => {
    expect(DASHBOARD_COLUMNS).toBe(3);
    expect(getCompositeDashboardDimensions(5)).toEqual({
      columns: 3,
      rows: 2,
      width: 24 * 2 + CARD_WIDTH * 3 + 24 * 2,
      height: 24 * 2 + CARD_HEIGHT * 2 + 24,
    });
  });

  test("renders multi-row composite dashboards with stale cards included", async () => {
    const cards = Array.from({ length: 5 }, (_, index) => ({
      characterId: String(110 + index),
      displayName: `Character ${110 + index}`,
      snapshot: {
        ...snapshot,
        name: `Character ${110 + index}`,
        lastUpdatedAt: new Date(`2026-04-07T21:1${index}:00Z`),
      },
      stale: index === 4,
    }));

    const attachment = await renderCompositeDashboard(cards);

    expect(attachment.filename).toBe(DASHBOARD_FILENAME);
    expect(attachment.data.length).toBeGreaterThan(0);
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
