import { describe, expect, test } from "vitest";

import { buildCharacterUrl, scrapeCharacterSheet } from "../src/fetcher.js";

const SAMPLE_CHARACTER_HTML = `
<html>
  <head><title>Paul-Paul Atreides - Character Sheet</title></head>
  <body>
    <table>
      <tr>
        <td><font size="-2">4</font></td>
        <td><font size="-2">4</font></td>
        <td><input type="text" name="initiative_miscmod" value="0" /></td>
      </tr>
    </table>

    <input type="text" name="stamina_total" value="5" />
    <input type="text" name="hp_total" value="7" />
    <input type="text" name="resolve_total" value="5" />
    <input type="text" name="stamina_current" value="5" />
    <input type="text" name="hp_current" value="7" />
    <input type="text" name="resolve_current" value="5" />

    <table>
      <tr>
        <td><font size="-2">15</font></td>
        <td>&nbsp;</td>
        <td><font size="-2">1</font></td>
        <td><font size="-2">4</font></td>
        <td><input type="text" name="ac_eac_miscmod" value="0" /></td>
      </tr>
      <tr>
        <td><font size="-2">16</font></td>
        <td>&nbsp;</td>
        <td><font size="-2">2</font></td>
        <td><font size="-2">4</font></td>
        <td><input type="text" name="ac_kac_miscmod" value="0" /></td>
      </tr>
    </table>

    <table>
      <tr>
        <td><font size="-2">0</font></td>
        <td><input type="text" name="saves_fortitude_basesave" value="0" /></td>
        <td><font size="-2">0</font></td>
        <td><input type="text" name="saves_fortitude_miscmod" value="0" /></td>
      </tr>
      <tr>
        <td><font size="-2">6</font></td>
        <td><input type="text" name="saves_reflex_basesave" value="2" /></td>
        <td><font size="-2">4</font></td>
        <td><input type="text" name="saves_reflex_miscmod" value="0" /></td>
      </tr>
      <tr>
        <td><font size="-2">0</font></td>
        <td><input type="text" name="saves_will_basesave" value="0" /></td>
        <td><font size="-2">0</font></td>
        <td><input type="text" name="saves_will_miscmod" value="0" /></td>
      </tr>
    </table>

    <table>
      <tr>
        <td><input type="text" name="base_attack_bonus" value="0" /></td>
      </tr>
      <tr>
        <td><font size="-2">-1</font></td>
        <td>&nbsp;</td>
        <td><font size="-2">0</font></td>
        <td><font size="-2">-1</font></td>
        <td><input type="text" name="melee_attack_miscmod" value="0" /></td>
      </tr>
      <tr>
        <td><font size="-2">4</font></td>
        <td>&nbsp;</td>
        <td><font size="-2">0</font></td>
        <td><font size="-2">4</font></td>
        <td><input type="text" name="ranged_attack_miscmod" value="0" /></td>
      </tr>
    </table>

    <table>
      <tr>
        <td><font size="-2">[<a href="Character-sheet.php?characterID=110&unequipSlotItemBtn=True">Un-Equip</a>]</font> Laser Pistol (1H)</td>
        <td>1</td>
        <td>4</td>
        <td><font size="-2">1d4 + LEV</font></td>
      </tr>
      <tr>
        <td><font size="-2">Burn 1d4</font></td>
        <td>80ft</td>
        <td>F</td>
        <td><font size="-2">52 / 1-20</font></td>
      </tr>
    </table>
  </body>
</html>
`;

describe("fetcher", () => {
  test("builds a character url from the configured base", () => {
    expect(buildCharacterUrl("https://private.example.test/Character-sheet.php", "245")).toBe(
      "https://private.example.test/Character-sheet.php?characterID=245",
    );
  });

  test("extracts the required dashboard fields", () => {
    const snapshot = scrapeCharacterSheet(SAMPLE_CHARACTER_HTML, {
      characterId: "110",
      now: new Date("2026-04-07T21:15:00Z"),
    });

    expect(snapshot.name).toBe("Paul-Paul Atreides");
    expect(snapshot.initiative).toBe("+4");
    expect(snapshot.hp).toBe("7/7");
    expect(snapshot.stamina).toBe("5/5");
    expect(snapshot.resolve).toBe("5/5");
    expect(snapshot.conditions).toBe("Unavailable");
    expect(snapshot.eac).toBe("15");
    expect(snapshot.kac).toBe("16");
    expect(snapshot.fort).toBe("+0");
    expect(snapshot.ref).toBe("+6");
    expect(snapshot.will).toBe("+0");
    expect(snapshot.attack).toBe("+4");
    expect(snapshot.weaponName).toBe("Laser Pistol");
    expect(snapshot.weaponDamage).toBe("1d4 + LEV");
    expect(snapshot.weaponDamageType).toBe("Burn 1d4");
    expect(snapshot.weaponRange).toBe("80 ft");
    expect(snapshot.weaponAmmo).toBe("52 / 1-20");
  });

  test("extracts checked conditions with mixed attribute order", () => {
    const html = `
      <html>
        <head><title>Condition Test - Character Sheet</title></head>
        <body>
          <input type="checkbox" checked name="condition_prone" />
          <input type="checkbox" name="conditions_off-kilter" checked="checked" />
        </body>
      </html>
    `;

    const snapshot = scrapeCharacterSheet(html, { characterId: "123" });
    expect(snapshot.conditions).toBe("Off-kilter, Prone");
  });

  test("missing fields fall back to unavailable", () => {
    const snapshot = scrapeCharacterSheet("<html><head><title>Unknown</title></head></html>", { characterId: "999" });

    expect(snapshot.name).toBe("Unknown");
    expect(snapshot.initiative).toBe("Unavailable");
    expect(snapshot.conditions).toBe("Unavailable");
    expect(snapshot.weaponName).toBe("Unavailable");
  });
});
