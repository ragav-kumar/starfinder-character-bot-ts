import { UNAVAILABLE, type CharacterSnapshot } from "./types.js";

export function buildCharacterUrl(baseUrl: string, characterId: string | number): string {
  const url = new URL(baseUrl);
  url.searchParams.set("characterID", String(characterId));
  return url.toString();
}

export async function fetchCharacterPage(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
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

function formatConditionLabel(condition: string): string {
  const normalized = normalizeText(condition)
    .toLowerCase()
    .replaceAll("_", "-")
    .replaceAll(" ", "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!normalized) {
    return "";
  }

  if (normalized === "off-kilter") {
    return "Off-kilter";
  }
  if (normalized === "flat-footed") {
    return "Flat-footed";
  }

  return normalized
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function extractConditions(html: string): string {
  const labels = new Set<string>();
  for (const match of html.matchAll(/<input[^>]*>/gi)) {
    const inputTag = match[0];
    if (!/checked/i.test(inputTag)) {
      continue;
    }

    const nameMatch =
      /name="((?:condition|conditions|modifier|modifiers|state)_[^"]+)"/i.exec(inputTag) ??
      /value="([^"]+)"/i.exec(inputTag);

    if (!nameMatch) {
      continue;
    }

    const rawCondition = nameMatch[1].replace(/^(?:condition|conditions|modifier|modifiers|state)_/i, "");
    const label = formatConditionLabel(rawCondition);
    if (label) {
      labels.add(label);
    }
  }

  return labels.size > 0 ? [...labels].sort().join(", ") : UNAVAILABLE;
}

function extractAttackBonus(html: string): string {
  let bestTotal: number | null = null;
  for (const inputName of ["melee_attack_miscmod", "ranged_attack_miscmod", "thrown_attack_miscmod"]) {
    const values = extractRowNumbers(html, inputName);
    if (values.length === 0) {
      continue;
    }

    const total = Number.parseInt(values[values.length - 1]!, 10);
    bestTotal = bestTotal === null ? total : Math.max(bestTotal, total);
  }

  if (bestTotal === null) {
    const baseAttack = extractInputValue(html, "base_attack_bonus");
    if (baseAttack && /^-?\d+$/.test(baseAttack)) {
      bestTotal = Number.parseInt(baseAttack, 10);
    }
  }

  return bestTotal === null ? UNAVAILABLE : formatSigned(String(bestTotal));
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

function extractEquippedWeapon(html: string): Pick<
  CharacterSnapshot,
  "weaponName" | "weaponDamage" | "weaponDamageType" | "weaponRange" | "weaponAmmo"
> {
  const fallback = {
    weaponName: UNAVAILABLE,
    weaponDamage: UNAVAILABLE,
    weaponDamageType: UNAVAILABLE,
    weaponRange: UNAVAILABLE,
    weaponAmmo: UNAVAILABLE,
  };

  const pattern =
    /\[(?:<a [^>]*>)?(?:Un-Equip|Equip)(?:<\/a>)?\]<\/font>\s*(?<name>[^<(]+?)(?:\s*\([^<]*\))?<\/td>.*?<td[^>]*><font[^>]*>(?<damage>[^<]*)<\/font><\/td>.*?<\/tr>\s*<tr>\s*<td[^>]*><font[^>]*>(?<damageType>[^<]*)<\/font><\/td>\s*<td[^>]*>(?<range>[^<]*)<\/td>\s*<td[^>]*>[^<]*<\/td>\s*<td[^>]*><font[^>]*>(?<ammo>[^<]*)<\/font><\/td>/is;
  const match = pattern.exec(html);
  if (!match?.groups) {
    return fallback;
  }

  return {
    weaponName: normalizeText(match.groups.name) || UNAVAILABLE,
    weaponDamage: normalizeText(match.groups.damage) || UNAVAILABLE,
    weaponDamageType: normalizeText(match.groups.damageType) || UNAVAILABLE,
    weaponRange: formatRange(match.groups.range),
    weaponAmmo: normalizeText(match.groups.ammo) || UNAVAILABLE,
  };
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
    attack: extractAttackBonus(html),
    weaponName: UNAVAILABLE,
    weaponDamage: UNAVAILABLE,
    weaponDamageType: UNAVAILABLE,
    weaponRange: UNAVAILABLE,
    weaponAmmo: UNAVAILABLE,
    lastUpdatedAt: options.now ?? new Date(),
  };

  Object.assign(snapshot, extractEquippedWeapon(html));
  return snapshot;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
