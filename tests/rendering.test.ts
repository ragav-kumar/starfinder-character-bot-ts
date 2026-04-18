import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import {
  buildCharacterCardTemplateData,
  CARD_HEIGHT,
  CARD_WIDTH,
  CHARACTER_CARD_TEMPLATE_KEYS,
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

  test("populates synthetic templates with escaped placeholder values", () => {
    const markup = populateCharacterCardTemplate(
      '<div><span id="displayName">placeholder</span><div id="weaponName">placeholder</div></div>',
      buildCharacterCardTemplateData("Paul <Paul>", "110", {
        ...snapshot,
        weaponName: "<Laser Pistol>",
      }, false),
    );

    expect(markup).toContain("Paul &lt;Paul&gt;");
    expect(markup).toContain("&lt;Laser Pistol&gt;");
  });

  test("replaces ids that are present in synthetic templates", () => {
    const markup = populateCharacterCardTemplate(
      '<div><span id="displayName">old</span><span id="status">old</span></div>',
      buildCharacterCardTemplateData("Paul-Paul Atreides", "110", snapshot, true),
    );

    expect(markup).toContain("Paul-Paul Atreides");
    expect(markup).toContain("STALE");
  });

  test("skips ids that are absent from synthetic templates", () => {
    expect(() =>
      populateCharacterCardTemplate(
        '<div><span id="displayName">old</span></div>',
        buildCharacterCardTemplateData("Paul-Paul Atreides", "110", snapshot, false),
      ),
    ).not.toThrow();
  });

  test("throws when a synthetic template reuses a supported id", () => {
    expect(() =>
      populateCharacterCardTemplate(
        '<div><span id="displayName">old</span><div id="displayName">again</div></div>',
        buildCharacterCardTemplateData("Paul-Paul Atreides", "110", snapshot, false),
      ),
    ).toThrow("Duplicate character card template id: displayName");
  });

  test("loads the checked-in character card template", async () => {
    const template = await readFile(new URL("../templates/character-card.html", import.meta.url), "utf8");

    expect(template.length).toBeGreaterThan(0);
  });

  test("uses only supported template variable ids in the checked-in template", async () => {
    const template = await readFile(new URL("../templates/character-card.html", import.meta.url), "utf8");
    const ids = [...template.matchAll(/\bid=(["'])([^"'<>]+)\1/g)].map((match) => match[2]);

    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => CHARACTER_CARD_TEMPLATE_KEYS.includes(id as (typeof CHARACTER_CARD_TEMPLATE_KEYS)[number]))).toBe(true);
  });

  test("renders checked-in template markup without assuming template shape", async () => {
    const markup = await renderCharacterCardMarkup(buildCharacterCardTemplateData("Paul-Paul Atreides", "110", snapshot, false));

    expect(markup).not.toContain("{{");
    expect(markup.length).toBeGreaterThan(0);
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
});
