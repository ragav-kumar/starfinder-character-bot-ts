import { UNAVAILABLE, type CharacterSnapshot, type SnapshotField, type TrackedCharacter } from "./types.js";

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

function padCell(value: string, width: number, align: "left" | "right" | "center"): string {
  if (align === "right") {
    return value.padStart(width);
  }
  if (align === "center") {
    return value.padStart(Math.floor((width + value.length) / 2)).padEnd(width);
  }
  return value.padEnd(width);
}

function renderTable(
  headers: readonly string[],
  values: readonly string[],
  minWidths: readonly number[],
  aligns: ReadonlyArray<"left" | "right" | "center">,
): string {
  const widths = headers.map((header, index) => Math.max(header.length, values[index]!.length, minWidths[index]!));
  const headerRow = headers.map((header, index) => padCell(header, widths[index]!, aligns[index]!)).join(" | ");
  const separatorRow = widths.map((width) => "-".repeat(width)).join("-|-");
  const valueRow = values.map((value, index) => padCell(value, widths[index]!, aligns[index]!)).join(" | ");
  return [headerRow, separatorRow, valueRow].join("\n");
}

function formatTimestamp(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
}

export function renderCharacterPanel(record: TrackedCharacter, snapshot: CharacterSnapshot, stale = false): string {
  const coreTable = renderTable(
    ["Init", "HP", "SP", "RP"],
    [snapshotValue(snapshot, "initiative"), snapshotValue(snapshot, "hp"), snapshotValue(snapshot, "stamina"), snapshotValue(snapshot, "resolve")],
    [4, 5, 5, 4],
    ["right", "right", "right", "right"],
  );
  const defenseTable = renderTable(
    ["EAC", "KAC", "Fort", "Ref", "Will"],
    [snapshotValue(snapshot, "eac"), snapshotValue(snapshot, "kac"), snapshotValue(snapshot, "fort"), snapshotValue(snapshot, "ref"), snapshotValue(snapshot, "will")],
    [4, 4, 4, 3, 4],
    ["right", "right", "right", "right", "right"],
  );
  const weaponTable = renderTable(
    ["Attack", "Name", "Damage", "Type", "Range", "Ammo"],
    [
      snapshotValue(snapshot, "attack"),
      snapshotValue(snapshot, "weaponName"),
      snapshotValue(snapshot, "weaponDamage"),
      snapshotValue(snapshot, "weaponDamageType"),
      snapshotValue(snapshot, "weaponRange"),
      snapshotValue(snapshot, "weaponAmmo"),
    ],
    [6, 12, 10, 9, 5, 11],
    ["right", "left", "left", "left", "left", "left"],
  );

  const conditions = snapshot.conditions === UNAVAILABLE ? "None" : snapshot.conditions;
  const footer = [
    stale ? "STALE - last refresh failed; showing the previous successful data." : null,
    `_Last updated: ${formatTimestamp(snapshot.lastUpdatedAt)}_`,
  ]
    .filter(Boolean)
    .join("\n");

  return [
    `**${record.displayName}** (\`ID: ${record.characterId}\`)`,
    "",
    "```text",
    coreTable,
    `Conditions: ${conditions}`,
    "",
    defenseTable,
    "",
    weaponTable,
    "```",
    footer,
  ].join("\n");
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
