"""Tests for the fetcher module."""

from textwrap import dedent
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import fetcher


SAMPLE_CHARACTER_HTML = dedent(
    """
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
    """
)


class TestBuildUrl:
    def test_character_url_uses_joe_corner_base(self):
        url = fetcher.build_character_url("110")
        assert url == "https://www.joescorner.ca/Starfinder/Character-sheet.php?characterID=110"

    def test_spaces_are_encoded(self):
        url = fetcher.build_url("?name={name}", name="Iron Man")
        assert "Iron%20Man" in url

    def test_slashes_in_values_are_encoded(self):
        url = fetcher.build_url("?name={name}", name="A/B")
        assert "A%2FB" in url

    def test_base_url_prefix_is_present(self):
        url = fetcher.build_url("?characterID=245")
        assert url == fetcher.BASE_URL + "?characterID=245"


class TestFetch:
    async def test_returns_response_text(self):
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.text = AsyncMock(return_value="<html>ok</html>")
        mock_resp.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_resp.__aexit__ = AsyncMock(return_value=False)

        mock_session = MagicMock()
        mock_session.get = MagicMock(return_value=mock_resp)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with patch("fetcher.aiohttp.ClientSession", return_value=mock_session):
            result = await fetcher.fetch("https://example.com/test")

        assert result == "<html>ok</html>"
        mock_resp.raise_for_status.assert_called_once()

    async def test_raises_on_bad_status(self):
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock(
            side_effect=Exception("404 Not Found")
        )
        mock_resp.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_resp.__aexit__ = AsyncMock(return_value=False)

        mock_session = MagicMock()
        mock_session.get = MagicMock(return_value=mock_resp)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with patch("fetcher.aiohttp.ClientSession", return_value=mock_session):
            with pytest.raises(Exception, match="404"):
                await fetcher.fetch("https://example.com/missing")


class TestScrapeCharacterSheet:
    def test_extracts_required_phase_2_fields(self):
        snapshot = fetcher.scrape_character_sheet(SAMPLE_CHARACTER_HTML, character_id="110")

        assert snapshot["name"] == "Paul-Paul Atreides"
        assert snapshot["initiative"] == "+4"
        assert snapshot["hp"] == "7/7"
        assert snapshot["stamina"] == "5/5"
        assert snapshot["resolve"] == "5/5"
        assert snapshot["conditions"] == "Unavailable"
        assert snapshot["eac"] == "15"
        assert snapshot["kac"] == "16"
        assert snapshot["fort"] == "+0"
        assert snapshot["ref"] == "+6"
        assert snapshot["will"] == "+0"
        assert snapshot["attack"] == "+4"
        assert snapshot["weapon_name"] == "Laser Pistol"
        assert snapshot["weapon_damage"] == "1d4 + LEV"
        assert snapshot["weapon_damage_type"] == "Burn 1d4"
        assert snapshot["weapon_range"] == "80 ft"
        assert snapshot["weapon_ammo"] == "52 / 1-20"

    def test_extracts_checked_conditions_with_mixed_attribute_order(self):
        html = """
        <html>
          <head><title>Condition Test - Character Sheet</title></head>
          <body>
            <input type="checkbox" checked name="condition_prone" />
            <input type="checkbox" name="conditions_off-kilter" checked="checked" />
          </body>
        </html>
        """

        snapshot = fetcher.scrape_character_sheet(html, character_id="123")

        assert snapshot["conditions"] == "Off-kilter, Prone"

    def test_missing_fields_fall_back_to_unavailable(self):
        snapshot = fetcher.scrape_character_sheet("<html><head><title>Unknown</title></head></html>", character_id="999")

        assert snapshot["name"] == "Unknown"
        assert snapshot["initiative"] == "Unavailable"
        assert snapshot["conditions"] == "Unavailable"
        assert snapshot["weapon_name"] == "Unavailable"
