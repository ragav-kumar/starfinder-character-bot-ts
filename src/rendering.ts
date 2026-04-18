import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import { html } from "satori-html";

import { UNAVAILABLE, type CharacterSnapshot, type RenderedDashboardAttachment, type SnapshotField } from "./types.js";

const require = createRequire(import.meta.url);

const DISPLAYED_FIELDS: Array<{ key: SnapshotField; label: string }> = [
  { key: "name", label: "Name" },
  { key: "characterClass", label: "Class" },
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
  { key: "weaponName", label: "Weapon" },
  { key: "weaponLevel", label: "Weapon level" },
  { key: "weaponAttack", label: "Weapon attack" },
  { key: "weaponDamage", label: "Damage" },
  { key: "weaponCritical", label: "Critical" },
  { key: "weaponDamageType", label: "Damage type" },
  { key: "weaponRange", label: "Range" },
  { key: "weaponAmmo", label: "Ammo" },
  { key: "weaponSpecial", label: "Weapon special" },
];

export const CARD_WIDTH = 450;
export const CARD_HEIGHT = 560;
export const DASHBOARD_COLUMNS = 3;
export const DASHBOARD_GAP = 24;
export const DASHBOARD_PADDING = 24;
export const DASHBOARD_FILENAME = "starfinder-dashboard.png";

interface FontDefinition {
  data: Buffer;
  name: string;
  weight: 400 | 700;
  style: "normal";
}

export interface CompositeDashboardCard {
  characterId: string;
  displayName: string;
  snapshot: CharacterSnapshot;
  stale: boolean;
}

const CHARACTER_CARD_TEMPLATE_KEYS = [
  "displayName",
  "characterId",
  "status",
  "lastUpdated",
  "characterClass",
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
  "weaponName",
  "weaponLevel",
  "weaponAttack",
  "weaponRange",
  "weaponAmmo",
  "weaponDamage",
  "weaponCritical",
  "weaponDamageType",
  "weaponSpecial",
] as const satisfies ReadonlyArray<keyof CharacterCardTemplateData>;

/**
 * Template ids available in `templates/character-card.html`.
 *
 * Card state:
 * - `displayName`: rendered character name shown in the card header
 * - `characterId`: numeric Starfinder character id
 * - `status`: short status text (`CURRENT` or `STALE`)
 * - `lastUpdated`: UTC timestamp formatted for display
 * - `characterClass`: combined class string from the sheet header
 *
 * Snapshot-backed values:
 * - `initiative`, `hp`, `stamina`, `resolve`
 * - `conditionsDisplay`: user-facing conditions text; falls back to `None` when conditions are unavailable
 * - `eac`, `kac`, `fort`, `ref`, `will`
 * - `weaponName`, `weaponLevel`, `weaponAttack`, `weaponRange`, `weaponAmmo`
 * - `weaponDamage`, `weaponCritical`, `weaponDamageType`, `weaponSpecial`
 *
 * Fallback semantics:
 * - All snapshot-backed values except `conditionsDisplay` fall back to `Unavailable`
 * - Replacement always HTML-escapes inserted values
 * - Template ids are optional; missing ids are skipped
 * - Duplicated ids still throw to keep the template contract in sync with this type
 */
export interface CharacterCardTemplateData {
  displayName: string;
  characterId: string;
  status: "CURRENT" | "STALE";
  lastUpdated: string;
  characterClass: string;
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
  weaponName: string;
  weaponLevel: string;
  weaponAttack: string;
  weaponRange: string;
  weaponAmmo: string;
  weaponDamage: string;
  weaponCritical: string;
  weaponDamageType: string;
  weaponSpecial: string;
}

const WEAPON_DISPLAY_FIELDS = new Set<SnapshotField>([
  "weaponLevel",
  "weaponAttack",
  "weaponDamage",
  "weaponCritical",
  "weaponDamageType",
  "weaponRange",
  "weaponAmmo",
  "weaponSpecial",
]);

let templatePromise: Promise<string> | undefined;
let fontDefinitionsPromise: Promise<FontDefinition[]> | undefined;

function snapshotValue(snapshot: CharacterSnapshot, key: SnapshotField): string {
  const value = String(snapshot[key]).trim();
  if (!value) {
    return UNAVAILABLE;
  }

  if (key === "hp" || key === "stamina" || key === "resolve") {
    return value.replace(/\s*\/\s*/g, " / ");
  }

  return value;
}

function weaponDisplayValue(snapshot: CharacterSnapshot, key: SnapshotField): string {
  const value = snapshotValue(snapshot, key);
  if (!WEAPON_DISPLAY_FIELDS.has(key)) {
    return value;
  }

  return value === UNAVAILABLE ? "-" : value;
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
  const weaponDamage = weaponDisplayValue(snapshot, "weaponDamage");
  const weaponDamageType = weaponDisplayValue(snapshot, "weaponDamageType");

  return {
    displayName: displayName.trim() || `Character ${characterId}`,
    characterId,
    status: stale ? "STALE" : "CURRENT",
    lastUpdated: formatTimestamp(snapshot.lastUpdatedAt),
    characterClass: snapshotValue(snapshot, "characterClass"),
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
    weaponName: snapshotValue(snapshot, "weaponName"),
    weaponLevel: weaponDisplayValue(snapshot, "weaponLevel"),
    weaponAttack: weaponDisplayValue(snapshot, "weaponAttack"),
    weaponRange: weaponDisplayValue(snapshot, "weaponRange"),
    weaponAmmo: weaponDisplayValue(snapshot, "weaponAmmo"),
    weaponDamage,
    weaponCritical: weaponDisplayValue(snapshot, "weaponCritical"),
    weaponDamageType,
    weaponSpecial: weaponDisplayValue(snapshot, "weaponSpecial"),
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
      continue;
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

async function renderCharacterCardSvg(data: CharacterCardTemplateData): Promise<string> {
  const markup = await renderCharacterCardMarkup(data);
  return satori(html(markup), {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    fonts: await loadFontDefinitions(),
  });
}

async function renderCharacterCardPngData(data: CharacterCardTemplateData): Promise<Buffer> {
  const svg = await renderCharacterCardSvg(data);
  return new Resvg(svg).render().asPng();
}

export async function renderCharacterCard(
  characterId: string,
  displayName: string,
  snapshot: CharacterSnapshot,
  stale = false,
): Promise<RenderedDashboardAttachment> {
  const data = buildCharacterCardTemplateData(displayName, characterId, snapshot, stale);
  const pngBuffer = await renderCharacterCardPngData(data);

  return {
    kind: "rendered",
    characterId,
    filename: `character-${characterId}.png`,
    contentType: "image/png",
    data: pngBuffer,
  };
}

function toDataUri(value: string | Buffer, contentType: string): string {
  const base64 = typeof value === "string" ? Buffer.from(value, "utf8").toString("base64") : value.toString("base64");
  return `data:${contentType};base64,${base64}`;
}

export function getCompositeDashboardDimensions(cardCount: number): { width: number; height: number; columns: number; rows: number } {
  const columns = Math.max(1, Math.min(DASHBOARD_COLUMNS, cardCount));
  const rows = Math.max(1, Math.ceil(cardCount / DASHBOARD_COLUMNS));

  return {
    columns,
    rows,
    width: DASHBOARD_PADDING * 2 + columns * CARD_WIDTH + Math.max(0, columns - 1) * DASHBOARD_GAP,
    height: DASHBOARD_PADDING * 2 + rows * CARD_HEIGHT + Math.max(0, rows - 1) * DASHBOARD_GAP,
  };
}

export async function renderCompositeDashboard(cards: CompositeDashboardCard[]): Promise<RenderedDashboardAttachment> {
  if (cards.length === 0) {
    throw new Error("Cannot render a composite dashboard without any cards.");
  }

  const { width, height } = getCompositeDashboardDimensions(cards.length);
  const renderedCards = await Promise.all(
    cards.map(async (card) => ({
      ...card,
      png: await renderCharacterCardPngData(
        buildCharacterCardTemplateData(card.displayName, card.characterId, card.snapshot, card.stale),
      ),
    })),
  );

  const images = renderedCards
    .map((card, index) => {
      const column = index % DASHBOARD_COLUMNS;
      const row = Math.floor(index / DASHBOARD_COLUMNS);
      const x = DASHBOARD_PADDING + column * (CARD_WIDTH + DASHBOARD_GAP);
      const y = DASHBOARD_PADDING + row * (CARD_HEIGHT + DASHBOARD_GAP);
      return `<image href="${toDataUri(card.png, "image/png")}" x="${x}" y="${y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" />`;
    })
    .join("");

  const compositeSvg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="#13202d" />`,
    `<rect x="8" y="8" width="${width - 16}" height="${height - 16}" rx="18" fill="#1a2b3b" stroke="#3b566f" stroke-width="2" />`,
    images,
    "</svg>",
  ].join("");

  return {
    kind: "rendered",
    characterId: "dashboard",
    filename: DASHBOARD_FILENAME,
    contentType: "image/png",
    data: new Resvg(compositeSvg).render().asPng(),
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
