import { logException } from "./logging.js";
import { UNAVAILABLE, type CharacterSnapshot } from "./types.js";

export function buildCharacterUrl(baseUrl: string, characterId: string | number): string {
  const url = new URL(baseUrl);
  url.searchParams.set("characterID", String(characterId));
  return url.toString();
}

export async function fetchCharacterPage(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    logException("fetchCharacterPage", error, { url });
    throw error;
  }

  if (!response.ok) {
    const error = new Error(`Request failed with ${response.status} for ${url}`);
    logException("fetchCharacterPage", error, { url, status: response.status });
    throw error;
  }
  return await response.text();
}

function normalizeText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&ndash;", "-")
    .replace(/\s+/g, " ")
    .trim();
}

function extractInputValue(html: string, inputName: string): string | null {
  const match = new RegExp(`name="${escapeRegExp(inputName)}"[^>]*value="([^"]*)"`, "i").exec(html);
  if (!match) {
    return null;
  }
  return normalizeText(match[1]) || null;
}

function extractSelectedValue(html: string, selectName: string): string | null {
  const selectMatch = new RegExp(
    `<select[^>]*name="${escapeRegExp(selectName)}"[^>]*>([\\s\\S]*?)<\\/select>`,
    "i",
  ).exec(html);
  if (!selectMatch) {
    return null;
  }

  const optionPattern = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
  for (const optionMatch of selectMatch[1].matchAll(optionPattern)) {
    const attributes = optionMatch[1] ?? "";
    if (!/\bselected(?:\s*=\s*(?:"selected"|'selected'|selected))?\b/i.test(attributes)) {
      continue;
    }

    const valueMatch = /value="([^"]*)"/i.exec(attributes);
    const preferredValue = normalizeText(valueMatch?.[1] ?? "");
    const fallbackValue = normalizeText(optionMatch[2] ?? "");
    return preferredValue || fallbackValue || null;
  }

  return null;
}

function extractRowNumbers(html: string, inputName: string): string[] {
  const anchor = new RegExp(`name="${escapeRegExp(inputName)}"`, "i").exec(html);
  if (!anchor?.index) {
    if (anchor?.index !== 0) {
      return [];
    }
  }

  const startIndex = anchor.index;
  const rowStart = html.lastIndexOf("<tr", startIndex);
  const rowEnd = html.indexOf("</tr>", startIndex);
  const fragment =
    rowStart === -1 || rowEnd === -1
      ? html.slice(Math.max(0, startIndex - 300), startIndex + 300)
      : html.slice(rowStart, rowEnd + "</tr>".length);

  const values: string[] = [];
  for (const match of fragment.matchAll(/<font[^>]*>(.*?)<\/font>/gis)) {
    const cleaned = normalizeText(match[1]);
    if (/^[-+]?\d+$/.test(cleaned)) {
      values.push(cleaned);
    }
  }
  return values;
}

function extractTitleName(html: string, fallback: string): string {
  const match = /<title>(.*?)<\/title>/is.exec(html);
  if (!match) {
    return fallback;
  }

  const titleText = normalizeText(match[1]).replace(/\s*-\s*Character Sheet\s*$/i, "");
  return titleText || fallback;
}

function formatSigned(value: string | null): string {
  if (!value?.trim()) {
    return UNAVAILABLE;
  }

  const cleaned = value.trim();
  if (/^-?\d+$/.test(cleaned)) {
    return cleaned.startsWith("-") ? cleaned : `+${cleaned}`;
  }
  return cleaned;
}

function formatPool(current: string | null, total: string | null): string {
  if (!current || !total) {
    return UNAVAILABLE;
  }
  return `${current}/${total}`;
}

function extractRowTotal(html: string, inputName: string, signed: boolean): string {
  const values = extractRowNumbers(html, inputName);
  if (values.length === 0) {
    return UNAVAILABLE;
  }
  return signed ? formatSigned(values[0]) : values[0];
}

function extractConditions(html: string): string {
  const state = extractSelectedValue(html, "character_state") ?? "";
  const additional = extractInputValue(html, "additionalmod") ?? "";

  return [state, additional].filter(Boolean).join(", ");
}

function extractCharacterClass(html: string): string {
  const classOne = extractInputValue(html, "character_class1") ?? "";
  const classTwo = extractInputValue(html, "character_class2") ?? "";

  return [classOne, classTwo].filter(Boolean).join(" / ");
}

function formatRange(value: string): string {
  const cleaned = normalizeText(value);
  if (!cleaned) {
    return UNAVAILABLE;
  }

  if (/ft$/i.test(cleaned) && !/\sft$/i.test(cleaned)) {
    return `${cleaned.slice(0, -2).trim()} ft`;
  }
  return cleaned;
}

function extractTableRows(html: string): string[] {
  return [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
}

function extractCells(rowHtml: string): string[] {
  return [...rowHtml.matchAll(/<td\b[^>]*>[\s\S]*?<\/td>/gi)].map((match) => match[0]);
}

function extractWeaponName(cellHtml: string): string {
  const cleaned = normalizeText(cellHtml).replace(/^\[\s*(?:Un-Equip|Equip)\s*\]\s*/i, "");
  return cleaned.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function extractWeaponAction(cellHtml: string): string {
  const match = />(Un-Equip|Equip)<\/a>/i.exec(cellHtml) ?? /\[(Un-Equip|Equip)\]/i.exec(normalizeText(cellHtml));
  return normalizeText(match?.[1] ?? "");
}

function extractEquippedWeapon(html: string): Pick<
  CharacterSnapshot,
  | "weaponName"
  | "weaponLevel"
  | "weaponAttack"
  | "weaponDamage"
  | "weaponCritical"
  | "weaponRange"
  | "weaponDamageType"
  | "weaponAmmo"
  | "weaponSpecial"
> {
  const fallback = {
    weaponName: UNAVAILABLE,
    weaponLevel: UNAVAILABLE,
    weaponAttack: UNAVAILABLE,
    weaponDamage: UNAVAILABLE,
    weaponCritical: UNAVAILABLE,
    weaponDamageType: UNAVAILABLE,
    weaponRange: UNAVAILABLE,
    weaponAmmo: UNAVAILABLE,
    weaponSpecial: UNAVAILABLE,
  };

  const rows = extractTableRows(html);
  for (let index = 0; index < rows.length - 1; index += 1) {
    const firstRowCells = extractCells(rows[index]!);
    if (firstRowCells.length < 4) {
      continue;
    }

    const action = extractWeaponAction(firstRowCells[0]!);
    if (action !== "Un-Equip") {
      continue;
    }

    const weaponName = extractWeaponName(firstRowCells[0]!);
    if (!weaponName) {
      continue;
    }

    const secondRowCells = extractCells(rows[index + 1]!);
    if (secondRowCells.length < 5) {
      continue;
    }

    return {
      weaponName,
      weaponLevel: normalizeText(firstRowCells[1]!) || UNAVAILABLE,
      weaponAttack: formatSigned(normalizeText(firstRowCells[2]!) || null),
      weaponDamage: normalizeText(firstRowCells[3]!) || UNAVAILABLE,
      weaponCritical: normalizeText(secondRowCells[0]!) || UNAVAILABLE,
      weaponRange: formatRange(secondRowCells[1]!),
      weaponDamageType: normalizeText(secondRowCells[2]!) || UNAVAILABLE,
      weaponAmmo: normalizeText(secondRowCells[3]!) || UNAVAILABLE,
      weaponSpecial: normalizeText(secondRowCells[4]!) || UNAVAILABLE,
    };
  }

  return fallback;
}

export function scrapeCharacterSheet(
  html: string,
  options: {
    characterId?: string | number;
    now?: Date;
  } = {},
): CharacterSnapshot {
  const fallbackName =
    options.characterId !== undefined ? `Character ${String(options.characterId)}` : "Unknown";

  const snapshot: CharacterSnapshot = {
    name: extractTitleName(html, fallbackName),
    characterClass: extractCharacterClass(html),
    initiative: extractRowTotal(html, "initiative_miscmod", true),
    hp: formatPool(extractInputValue(html, "hp_current"), extractInputValue(html, "hp_total")),
    stamina: formatPool(extractInputValue(html, "stamina_current"), extractInputValue(html, "stamina_total")),
    resolve: formatPool(extractInputValue(html, "resolve_current"), extractInputValue(html, "resolve_total")),
    conditions: extractConditions(html),
    eac: extractRowTotal(html, "ac_eac_miscmod", false),
    kac: extractRowTotal(html, "ac_kac_miscmod", false),
    fort: extractRowTotal(html, "saves_fortitude_basesave", true),
    ref: extractRowTotal(html, "saves_reflex_basesave", true),
    will: extractRowTotal(html, "saves_will_basesave", true),
    weaponName: UNAVAILABLE,
    weaponLevel: UNAVAILABLE,
    weaponAttack: UNAVAILABLE,
    weaponDamage: UNAVAILABLE,
    weaponCritical: UNAVAILABLE,
    weaponDamageType: UNAVAILABLE,
    weaponRange: UNAVAILABLE,
    weaponAmmo: UNAVAILABLE,
    weaponSpecial: UNAVAILABLE,
    lastUpdatedAt: options.now ?? new Date(),
  };

  Object.assign(snapshot, extractEquippedWeapon(html));
  return snapshot;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
