import { createCanvas } from "@napi-rs/canvas";

import { UNAVAILABLE, type CharacterSnapshot, type RenderedDashboardAttachment, type SnapshotField } from "./types.js";

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

function snapshotValue(snapshot: CharacterSnapshot, key: SnapshotField): string {
  const value = String(snapshot[key]).trim();
  return value || UNAVAILABLE;
}

function formatTimestamp(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
}

function wrapText(text: string, lineLength: number): string[] {
  if (text.length <= lineLength) {
    return [text];
  }

  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > lineLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [text];
}

export function buildCharacterCardLines(displayName: string, characterId: string, snapshot: CharacterSnapshot, stale: boolean): string[] {
  const lines = [
    displayName,
    `ID: ${characterId}`,
    stale ? "STALE - last refresh failed" : "Status: current",
    `Initiative  ${snapshotValue(snapshot, "initiative")}`,
    `HP / SP / RP  ${snapshotValue(snapshot, "hp")} | ${snapshotValue(snapshot, "stamina")} | ${snapshotValue(snapshot, "resolve")}`,
    `Conditions  ${snapshot.conditions === UNAVAILABLE ? "None" : snapshot.conditions}`,
    `EAC / KAC  ${snapshotValue(snapshot, "eac")} / ${snapshotValue(snapshot, "kac")}`,
    `Saves  Fort ${snapshotValue(snapshot, "fort")} | Ref ${snapshotValue(snapshot, "ref")} | Will ${snapshotValue(snapshot, "will")}`,
    `Attack  ${snapshotValue(snapshot, "attack")}`,
    `Weapon  ${snapshotValue(snapshot, "weaponName")}`,
    `Damage  ${snapshotValue(snapshot, "weaponDamage")} ${snapshotValue(snapshot, "weaponDamageType")}`,
    `Range  ${snapshotValue(snapshot, "weaponRange")}   Ammo  ${snapshotValue(snapshot, "weaponAmmo")}`,
    `Last updated  ${formatTimestamp(snapshot.lastUpdatedAt)}`,
  ];

  return lines.flatMap((line, index) => (index >= 5 ? wrapText(line, 22) : [line]));
}

export function renderCharacterCard(
  characterId: string,
  displayName: string,
  snapshot: CharacterSnapshot,
  stale = false,
): RenderedDashboardAttachment {
  const width = 450;
  const height = 560;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");

  context.fillStyle = "#f3ecd8";
  context.fillRect(0, 0, width, height);

  context.fillStyle = stale ? "#8d2f2f" : "#294c3b";
  context.fillRect(0, 0, width, 80);

  context.fillStyle = "#1f1d17";
  context.fillRect(18, 96, width - 36, height - 114);

  context.fillStyle = "#f8f2df";
  context.font = "bold 22px sans-serif";
  context.fillText(displayName, 24, 44, width - 48);
  context.font = "16px sans-serif";
  context.fillText(`Character ${characterId}`, 24, 66);

  const lines = buildCharacterCardLines(displayName, characterId, snapshot, stale);
  context.font = "16px sans-serif";
  let y = 126;
  for (const [index, line] of lines.entries()) {
    context.fillStyle = index === 2 && stale ? "#ffb0b0" : "#f8f2df";
    context.fillText(line, 32, y, width - 64);
    y += 21;
  }

  context.strokeStyle = stale ? "#d65c5c" : "#85b199";
  context.lineWidth = 3;
  context.strokeRect(20, 98, width - 40, height - 118);

  return {
    kind: "rendered",
    characterId,
    filename: `character-${characterId}.png`,
    contentType: "image/png",
    data: canvas.toBuffer("image/png"),
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
