import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import { html } from "satori-html";

import { UNAVAILABLE, type CharacterSnapshot, type RenderedDashboardAttachment, type SnapshotField } from "./types.js";

const require = createRequire(import.meta.url);

const DISPLAYED_FIELDS: Array<{ key: SnapshotField; label: string }> = [
  { key: "name", label: "Name" },
  { key: "initiative", label: "Initiative" },
  { key: "hp", label: "HP" },
  { key: "stamina", label: "SP" },
  { key: "resolve", label: "RP" },
  { key: "conditions", label: "Conditions" },
  { key: "eac", label: "EAC" },
  { key: "kac", label: "KAC" },
  { key: "fort", label: "Fort" },
  { key: "ref", label: "Ref" },
  { key: "will", label: "Will" },
  { key: "attack", label: "Attack" },
  { key: "weaponName", label: "Weapon" },
  { key: "weaponDamage", label: "Damage" },
  { key: "weaponDamageType", label: "Damage type" },
  { key: "weaponRange", label: "Range" },
  { key: "weaponAmmo", label: "Ammo" },
];

export const CARD_WIDTH = 450;
export const CARD_HEIGHT = 560;

interface FontDefinition {
  data: Buffer;
  name: string;
  weight: 400 | 700;
  style: "normal";
}

const CHARACTER_CARD_TEMPLATE_KEYS = [
  "displayName",
  "characterId",
  "status",
  "lastUpdated",
  "initiative",
  "hp",
  "stamina",
  "resolve",
  "conditionsDisplay",
  "eac",
  "kac",
  "fort",
  "ref",
  "will",
  "attack",
  "weaponName",
  "weaponRange",
  "weaponAmmo",
  "weaponDamage",
  "weaponDamageType",
  "damageSummary",
] as const satisfies ReadonlyArray<keyof CharacterCardTemplateData>;

/**
 * Template ids available in `templates/character-card.html`.
 *
 * Card state:
 * - `displayName`: rendered character name shown in the card header
 * - `characterId`: numeric Starfinder character id
 * - `status`: short status text (`CURRENT` or `STALE`)
 * - `lastUpdated`: UTC timestamp formatted for display
 *
 * Snapshot-backed values:
 * - `initiative`, `hp`, `stamina`, `resolve`
 * - `conditionsDisplay`: user-facing conditions text; falls back to `None` when conditions are unavailable
 * - `eac`, `kac`, `fort`, `ref`, `will`
 * - `attack`, `weaponName`, `weaponRange`, `weaponAmmo`
 * - `weaponDamage`, `weaponDamageType`
 * - `damageSummary`: preformatted `${weaponDamage} ${weaponDamageType}` string
 *
 * Fallback semantics:
 * - All snapshot-backed values except `conditionsDisplay` fall back to `Unavailable`
 * - Replacement always HTML-escapes inserted values
 * - Each field key must map to exactly one `span` or `div` id in the template
 * - Missing or duplicated ids throw to keep the template contract in sync with this type
 */
export interface CharacterCardTemplateData {
  displayName: string;
  characterId: string;
  status: "CURRENT" | "STALE";
  lastUpdated: string;
  initiative: string;
  hp: string;
  stamina: string;
  resolve: string;
  conditionsDisplay: string;
  eac: string;
  kac: string;
  fort: string;
  ref: string;
  will: string;
  attack: string;
  weaponName: string;
  weaponRange: string;
  weaponAmmo: string;
  weaponDamage: string;
  weaponDamageType: string;
  damageSummary: string;
}

let templatePromise: Promise<string> | undefined;
let fontDefinitionsPromise: Promise<FontDefinition[]> | undefined;

function snapshotValue(snapshot: CharacterSnapshot, key: SnapshotField): string {
  const value = String(snapshot[key]).trim();
  return value || UNAVAILABLE;
}

export function formatTimestamp(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
}

function resolveConditionsDisplay(snapshot: CharacterSnapshot): string {
  const conditions = snapshotValue(snapshot, "conditions");
  return conditions === UNAVAILABLE ? "None" : conditions;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function loadCharacterCardTemplate(): Promise<string> {
  templatePromise ??= readFile(new URL("../templates/character-card.html", import.meta.url), "utf8");
  return templatePromise;
}

async function loadFontDefinitions(): Promise<FontDefinition[]> {
  fontDefinitionsPromise ??= Promise.all([
    readFile(require.resolve("@fontsource/orbitron/files/orbitron-latin-400-normal.woff")),
    readFile(require.resolve("@fontsource/orbitron/files/orbitron-latin-700-normal.woff")),
  ]).then(([regular, bold]) => [
    { name: "Orbitron", data: regular, weight: 400, style: "normal" as const },
    { name: "Orbitron", data: bold, weight: 700, style: "normal" as const },
  ]);

  return fontDefinitionsPromise;
}

export function buildCharacterCardTemplateData(
  displayName: string,
  characterId: string,
  snapshot: CharacterSnapshot,
  stale: boolean,
): CharacterCardTemplateData {
  const weaponDamage = snapshotValue(snapshot, "weaponDamage");
  const weaponDamageType = snapshotValue(snapshot, "weaponDamageType");

  return {
    displayName: displayName.trim() || `Character ${characterId}`,
    characterId,
    status: stale ? "STALE" : "CURRENT",
    lastUpdated: formatTimestamp(snapshot.lastUpdatedAt),
    initiative: snapshotValue(snapshot, "initiative"),
    hp: snapshotValue(snapshot, "hp"),
    stamina: snapshotValue(snapshot, "stamina"),
    resolve: snapshotValue(snapshot, "resolve"),
    conditionsDisplay: resolveConditionsDisplay(snapshot),
    eac: snapshotValue(snapshot, "eac"),
    kac: snapshotValue(snapshot, "kac"),
    fort: snapshotValue(snapshot, "fort"),
    ref: snapshotValue(snapshot, "ref"),
    will: snapshotValue(snapshot, "will"),
    attack: snapshotValue(snapshot, "attack"),
    weaponName: snapshotValue(snapshot, "weaponName"),
    weaponRange: snapshotValue(snapshot, "weaponRange"),
    weaponAmmo: snapshotValue(snapshot, "weaponAmmo"),
    weaponDamage,
    weaponDamageType,
    damageSummary: `${weaponDamage} ${weaponDamageType}`.trim(),
  };
}

export function populateCharacterCardTemplate(template: string, data: CharacterCardTemplateData): string {
  let markup = template;

  for (const key of CHARACTER_CARD_TEMPLATE_KEYS) {
    const pattern = new RegExp(
      `(<(span|div)\\b[^>]*\\bid=(["'])${escapeRegExp(key)}\\3[^>]*>)([\\s\\S]*?)(</\\2>)`,
      "g",
    );
    const matches = [...markup.matchAll(pattern)];

    if (matches.length === 0) {
      throw new Error(`Missing character card template id: ${key}`);
    }
    if (matches.length > 1) {
      throw new Error(`Duplicate character card template id: ${key}`);
    }

    markup = markup.replace(pattern, (_match, openingTag: string, _tagName: string, _quote: string, _content: string, closingTag: string) => {
      return `${openingTag}${escapeHtml(data[key])}${closingTag}`;
    });
  }

  return markup;
}

export async function renderCharacterCardMarkup(data: CharacterCardTemplateData): Promise<string> {
  const template = await loadCharacterCardTemplate();
  return populateCharacterCardTemplate(template, data);
}

export async function renderCharacterCard(
  characterId: string,
  displayName: string,
  snapshot: CharacterSnapshot,
  stale = false,
): Promise<RenderedDashboardAttachment> {
  const data = buildCharacterCardTemplateData(displayName, characterId, snapshot, stale);
  const markup = await renderCharacterCardMarkup(data);
  const svg = await satori(html(markup), {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    fonts: await loadFontDefinitions(),
  });
  const pngBuffer = new Resvg(svg).render().asPng();

  return {
    kind: "rendered",
    characterId,
    filename: `character-${characterId}.png`,
    contentType: "image/png",
    data: pngBuffer,
  };
}

export function diffSnapshots(previous: CharacterSnapshot | undefined, current: CharacterSnapshot): string[] {
  if (!previous) {
    return [];
  }

  const changes: string[] = [];
  for (const field of DISPLAYED_FIELDS) {
    const oldValue = snapshotValue(previous, field.key);
    const newValue = snapshotValue(current, field.key);
    if (oldValue !== newValue) {
      changes.push(`${field.label} changed ${oldValue} → ${newValue}`);
    }
  }

  return changes;
}
