import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { buildCharacterUrl, fetchCharacterPage, scrapeCharacterSheet } from "../src/fetcher.js";

const SAMPLE_CHARACTER_HTML = `
<html>
  <head><title>Paul-Paul Atreides - Character Sheet</title></head>
  <body>
    <input type="text" name="character_class1" value="Precog" />
    <input type="text" name="character_class2" value="" />

    <select name="character_state">
      <option value=""></option>
      <option value="In-Stealth" selected>In-Stealth</option>
    </select>
    <input type="text" name="additionalmod" value="Off-kilter" />

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
        <td><font size="-2">[<a href="Character-sheet.php?characterID=110&equipSlotItemBtn=True">Equip</a>]</font> POI Rifle, T (2H)</td>
        <td>1</td>
        <td>1</td>
        <td><font size="-2">1d8</font></td>
        <td>&nbsp;</td>
      </tr>
      <tr>
        <td><font size="-2"></font></td>
        <td>70/250</td>
        <td>F</td>
        <td><font size="-2">52 / 10</font></td>
        <td><font size="-2">True Name: Process Optimization Implement</font></td>
      </tr>
      <tr>
        <td>&nbsp;</td>
        <td>&nbsp;</td>
        <td>&nbsp;</td>
        <td>&nbsp;</td>
        <td>&nbsp;</td>
      </tr>
      <tr>
        <td><font size="-2">[<a href="Character-sheet.php?characterID=110&unequipSlotItemBtn=True">Un-Equip</a>]</font> Laser Pistol (1H)</td>
        <td>1</td>
        <td>4</td>
        <td><font size="-2">1d4 + LEV</font></td>
        <td>&nbsp;</td>
      </tr>
      <tr>
        <td><font size="-2">Burn 1d4</font></td>
        <td>80ft</td>
        <td>F</td>
        <td><font size="-2">52 / 1-20</font></td>
        <td><font size="-2"></font></td>
      </tr>
      <tr>
        <td> </td>
        <td></td>
        <td></td>
        <td><font size="-2"></font></td>
        <td><font size="-2"></font></td>
      </tr>
      <tr>
        <td> </td>
        <td></td>
        <td></td>
        <td><font size="-2"></font></td>
        <td><font size="-2"></font></td>
      </tr>
      <tr>
        <td><font size="-2"></font></td>
        <td></td>
        <td></td>
        <td><font size="-2"></font></td>
        <td><font size="-2"></font></td>
      </tr>
    </table>
  </body>
</html>
`;

describe("fetcher", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.unstubAllGlobals();
  });

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
    expect(snapshot.characterClass).toBe("Precog");
    expect(snapshot.initiative).toBe("+4");
    expect(snapshot.hp).toBe("7/7");
    expect(snapshot.stamina).toBe("5/5");
    expect(snapshot.resolve).toBe("5/5");
    expect(snapshot.conditions).toBe("In-Stealth, Off-kilter");
    expect(snapshot.eac).toBe("15");
    expect(snapshot.kac).toBe("16");
    expect(snapshot.fort).toBe("+0");
    expect(snapshot.ref).toBe("+6");
    expect(snapshot.will).toBe("+0");
    expect(snapshot.weaponName).toBe("Laser Pistol");
    expect(snapshot.weaponLevel).toBe("1");
    expect(snapshot.weaponAttack).toBe("+4");
    expect(snapshot.weaponDamage).toBe("1d4 + LEV");
    expect(snapshot.weaponCritical).toBe("Burn 1d4");
    expect(snapshot.weaponRange).toBe("80 ft");
    expect(snapshot.weaponDamageType).toBe("F");
    expect(snapshot.weaponAmmo).toBe("52 / 1-20");
    expect(snapshot.weaponSpecial).toBe("Unavailable");
  });

  test("prefers the equipped weapon row and ignores blank trailing groups", () => {
    const html = `
      <html>
        <head><title>Condition Test - Character Sheet</title></head>
        <body>
          <table>
            <tr>
              <td><font size="-2">[<a href="#">Equip</a>]</font> Club (1H)</td>
              <td>0</td>
              <td>-1</td>
              <td><font size="-2">1d4</font></td>
              <td>&nbsp;</td>
            </tr>
            <tr>
              <td><font size="-2"></font></td>
              <td>5ft</td>
              <td>B</td>
              <td><font size="-2">-</font></td>
              <td><font size="-2"></font></td>
            </tr>
            <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
            <tr>
              <td><font size="-2">[<a href="#">Un-Equip</a>]</font> Arc Emitter (1H)</td>
              <td>3</td>
              <td>7</td>
              <td><font size="-2">2d4</font></td>
              <td>&nbsp;</td>
            </tr>
            <tr>
              <td><font size="-2">Arc 1</font></td>
              <td>30ft</td>
              <td>E</td>
              <td><font size="-2">20 / 20</font></td>
              <td><font size="-2">Line</font></td>
            </tr>
            <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
            <tr>
              <td> </td>
              <td></td>
              <td></td>
              <td><font size="-2"></font></td>
              <td><font size="-2"></font></td>
            </tr>
            <tr>
              <td><font size="-2"></font></td>
              <td></td>
              <td></td>
              <td><font size="-2"></font></td>
              <td><font size="-2"></font></td>
            </tr>
          </table>
        </body>
      </html>
    `;

    const snapshot = scrapeCharacterSheet(html, { characterId: "123" });
    expect(snapshot.weaponName).toBe("Arc Emitter");
    expect(snapshot.weaponLevel).toBe("3");
    expect(snapshot.weaponAttack).toBe("+7");
    expect(snapshot.weaponCritical).toBe("Arc 1");
    expect(snapshot.weaponDamageType).toBe("E");
    expect(snapshot.weaponSpecial).toBe("Line");
  });

  test("parses the last equipped weapon even when no spacer row follows it", () => {
    const html = `
      <html>
        <body>
          <table>
            <tr>
              <td><font size="-2">[<a href="#">Un-Equip</a>]</font> Pike (2H)</td>
              <td>2</td>
              <td>5</td>
              <td><font size="-2">1d8</font></td>
              <td>&nbsp;</td>
            </tr>
            <tr>
              <td><font size="-2">Bleed 1d4</font></td>
              <td>10ft</td>
              <td>P</td>
              <td><font size="-2">-</font></td>
              <td><font size="-2">Reach</font></td>
            </tr>
          </table>
        </body>
      </html>
    `;

    const snapshot = scrapeCharacterSheet(html, { characterId: "321" });
    expect(snapshot.weaponName).toBe("Pike");
    expect(snapshot.weaponAttack).toBe("+5");
    expect(snapshot.weaponSpecial).toBe("Reach");
  });

  test("extracts condition from select only", () => {
    const html = `
      <html>
        <body>
          <select name="character_state">
            <option value=""></option>
            <option value="Asleep" selected>Asleep</option>
          </select>
          <input type="text" name="additionalmod" value="" />
        </body>
      </html>
    `;

    expect(scrapeCharacterSheet(html, { characterId: "1" }).conditions).toBe("Asleep");
  });

  test("extracts condition from additional modifier only", () => {
    const html = `
      <html>
        <body>
          <select name="character_state">
            <option value="" selected></option>
          </select>
          <input type="text" name="additionalmod" value="Flat-footed" />
        </body>
      </html>
    `;

    expect(scrapeCharacterSheet(html, { characterId: "1" }).conditions).toBe("Flat-footed");
  });

  test("returns an empty condition when both sources are blank", () => {
    const html = `
      <html>
        <body>
          <select name="character_state">
            <option value="" selected></option>
          </select>
          <input type="text" name="additionalmod" value="" />
        </body>
      </html>
    `;

    expect(scrapeCharacterSheet(html, { characterId: "1" }).conditions).toBe("");
  });

  test("combines character classes when both class fields are present", () => {
    const html = `
      <html>
        <body>
          <input type="text" name="character_class1" value="Precog" />
          <input type="text" name="character_class2" value="Soldier" />
        </body>
      </html>
    `;

    expect(scrapeCharacterSheet(html, { characterId: "1" }).characterClass).toBe("Precog / Soldier");
  });

  test("uses only the first class when the second class is blank", () => {
    const html = `
      <html>
        <body>
          <input type="text" name="character_class1" value="Mystic" />
          <input type="text" name="character_class2" value="" />
        </body>
      </html>
    `;

    expect(scrapeCharacterSheet(html, { characterId: "1" }).characterClass).toBe("Mystic");
  });

  test("logs and throws when the response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
      })),
    );

    await expect(fetchCharacterPage("https://private.example.test/Character-sheet.php?characterID=245")).rejects.toThrow(
      "Request failed with 503 for https://private.example.test/Character-sheet.php?characterID=245",
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("fetchCharacterPage"));
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("https://private.example.test/Character-sheet.php?characterID=245"),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("503"));
  });

  test("missing fields fall back to unavailable", () => {
    const snapshot = scrapeCharacterSheet("<html><head><title>Unknown</title></head></html>", { characterId: "999" });

    expect(snapshot.name).toBe("Unknown");
    expect(snapshot.initiative).toBe("Unavailable");
    expect(snapshot.conditions).toBe("");
    expect(snapshot.weaponName).toBe("Unavailable");
  });
});
