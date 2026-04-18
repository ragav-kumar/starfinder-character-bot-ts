"""URL construction, async HTTP fetching, and lightweight scraping helpers."""

from __future__ import annotations

import re
from html import unescape
from typing import TypeAlias
from urllib.parse import quote

import aiohttp

BASE_URL = "https://www.joescorner.ca/Starfinder/Character-sheet.php"
UNAVAILABLE = "Unavailable"
Snapshot: TypeAlias = dict[str, str]


def build_url(query_template: str = "", **kwargs: str) -> str:
    """Return a Joe's Corner character-sheet URL with encoded query values."""
    encoded = {key: quote(str(value), safe="") for key, value in kwargs.items()}
    query = query_template.format(**encoded)
    if query and not query.startswith("?"):
        query = "?" + query.lstrip("?")
    return BASE_URL + query


def build_character_url(character_id: str | int) -> str:
    """Build the canonical Starfinder character URL for one numeric ID."""
    return build_url("?characterID={character_id}", character_id=str(character_id))


async def fetch(url: str) -> str:
    """Fetch *url* and return the response body as a string."""
    print(f"[fetcher] GET {url}", flush=True)
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            response.raise_for_status()
            return await response.text()


def _normalize_text(value: str) -> str:
    """Collapse HTML fragments into normalized human-readable text."""
    text = unescape(re.sub(r"<[^>]+>", " ", value))
    text = text.replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def _extract_input_value(html: str, input_name: str) -> str | None:
    """Return the value of a named input field when present."""
    match = re.search(
        rf'name="{re.escape(input_name)}"[^>]*value="([^"]*)"',
        html,
        re.IGNORECASE,
    )
    if match is None:
        return None
    value = _normalize_text(match.group(1))
    return value or None


def _extract_row_numbers(html: str, input_name: str) -> list[str]:
    """Return numeric `<font>` values from the table row around *input_name*."""
    anchor = re.search(rf'name="{re.escape(input_name)}"', html, re.IGNORECASE)
    if anchor is None:
        return []

    row_start = html.rfind("<tr", 0, anchor.start())
    row_end = html.find("</tr>", anchor.end())
    if row_start == -1 or row_end == -1:
        fragment = html[max(0, anchor.start() - 300) : anchor.end() + 300]
    else:
        fragment = html[row_start : row_end + len("</tr>")]

    values: list[str] = []
    for candidate in re.findall(r"<font[^>]*>(.*?)</font>", fragment, re.IGNORECASE | re.DOTALL):
        cleaned = _normalize_text(candidate)
        if re.fullmatch(r"[-+]?\d+", cleaned):
            values.append(cleaned)
    return values


def _extract_title_name(html: str, *, fallback: str) -> str:
    """Resolve the character name from the page title when available."""
    match = re.search(r"<title>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    if match is None:
        return fallback

    title_text = _normalize_text(match.group(1))
    title_text = re.sub(r"\s*-\s*Character Sheet\s*$", "", title_text, flags=re.IGNORECASE)
    return title_text or fallback


def _format_signed(value: str | None) -> str:
    """Return a signed numeric display string or `Unavailable`."""
    if value is None:
        return UNAVAILABLE

    cleaned = value.strip()
    if not cleaned:
        return UNAVAILABLE
    if re.fullmatch(r"-?\d+", cleaned):
        return cleaned if cleaned.startswith("-") else f"+{cleaned}"
    return cleaned


def _format_pool(current: str | None, total: str | None) -> str:
    """Return a `current/total` pool display string."""
    if not current or not total:
        return UNAVAILABLE
    return f"{current}/{total}"


def _extract_row_total(html: str, input_name: str, *, signed: bool) -> str:
    """Return the first numeric value in the row surrounding *input_name*."""
    values = _extract_row_numbers(html, input_name)
    if not values:
        return UNAVAILABLE
    return _format_signed(values[0]) if signed else values[0]


def _format_condition_label(condition: str) -> str:
    """Normalize a raw condition token into a readable label."""
    normalized = _normalize_text(condition).strip().lower().replace("_", "-").replace(" ", "-")
    normalized = re.sub(r"-+", "-", normalized).strip("-")
    if not normalized:
        return ""

    canonical_labels = {
        "off-kilter": "Off-kilter",
        "flat-footed": "Flat-footed",
    }
    if normalized in canonical_labels:
        return canonical_labels[normalized]

    return " ".join(part.capitalize() for part in normalized.split("-"))


def _extract_conditions(html: str) -> str:
    """Best-effort extraction for active conditions from checked condition inputs."""
    labels: set[str] = set()
    for input_tag in re.findall(r"<input[^>]*>", html, re.IGNORECASE):
        if "checked" not in input_tag.lower():
            continue

        match = re.search(r'name="((?:condition|conditions)_[^"]+)"', input_tag, re.IGNORECASE)
        if match is None:
            continue

        raw_name = match.group(1)
        raw_condition = re.sub(r"^(?:condition|conditions)_", "", raw_name, flags=re.IGNORECASE)
        label = _format_condition_label(raw_condition)
        if label:
            labels.add(label)

    return ", ".join(sorted(labels)) if labels else UNAVAILABLE


def _extract_attack_bonus(html: str) -> str:
    """Return the best total attack bonus shown in the attack rows."""
    best_total: int | None = None
    for input_name in (
        "melee_attack_miscmod",
        "ranged_attack_miscmod",
        "thrown_attack_miscmod",
    ):
        values = _extract_row_numbers(html, input_name)
        if not values:
            continue

        total = int(values[-1])
        best_total = total if best_total is None else max(best_total, total)

    if best_total is None:
        base_attack = _extract_input_value(html, "base_attack_bonus")
        if base_attack and re.fullmatch(r"-?\d+", base_attack):
            best_total = int(base_attack)

    return _format_signed(str(best_total)) if best_total is not None else UNAVAILABLE


def _format_range(value: str) -> str:
    """Normalize the weapon range display."""
    cleaned = _normalize_text(value)
    if not cleaned:
        return UNAVAILABLE
    if cleaned.lower().endswith("ft") and not cleaned.lower().endswith(" ft"):
        return f"{cleaned[:-2].strip()} ft"
    return cleaned


def _extract_equipped_weapon(html: str) -> Snapshot:
    """Return the currently equipped weapon block when one is visible."""
    fallback = {
        "weapon_name": UNAVAILABLE,
        "weapon_damage": UNAVAILABLE,
        "weapon_damage_type": UNAVAILABLE,
        "weapon_range": UNAVAILABLE,
        "weapon_ammo": UNAVAILABLE,
    }

    pattern = re.compile(
        r"\[(?:<a [^>]*>)?(?:Un-Equip|Equip)(?:</a>)?\]</font>\s*"
        r"(?P<name>[^<(]+?)(?:\s*\([^<]*\))?</td>"
        r".*?<td[^>]*><font[^>]*>(?P<damage>[^<]*)</font></td>"
        r".*?</tr>\s*<tr>\s*<td[^>]*><font[^>]*>(?P<damage_type>[^<]*)</font></td>"
        r"\s*<td[^>]*>(?P<range>[^<]*)</td>"
        r"\s*<td[^>]*>[^<]*</td>"
        r"\s*<td[^>]*><font[^>]*>(?P<ammo>[^<]*)</font></td>",
        re.IGNORECASE | re.DOTALL,
    )
    match = pattern.search(html)
    if match is None:
        return fallback

    return {
        "weapon_name": _normalize_text(match.group("name")) or UNAVAILABLE,
        "weapon_damage": _normalize_text(match.group("damage")) or UNAVAILABLE,
        "weapon_damage_type": _normalize_text(match.group("damage_type")) or UNAVAILABLE,
        "weapon_range": _format_range(match.group("range")),
        "weapon_ammo": _normalize_text(match.group("ammo")) or UNAVAILABLE,
    }


def scrape_character_sheet(html: str, *, character_id: str | int | None = None) -> Snapshot:
    """Extract the Phase 2 dashboard fields from one character-sheet page."""
    fallback_name = f"Character {character_id}" if character_id is not None else "Unknown"
    snapshot: Snapshot = {
        "name": _extract_title_name(html, fallback=fallback_name),
        "initiative": _extract_row_total(html, "initiative_miscmod", signed=True),
        "hp": _format_pool(_extract_input_value(html, "hp_current"), _extract_input_value(html, "hp_total")),
        "stamina": _format_pool(
            _extract_input_value(html, "stamina_current"),
            _extract_input_value(html, "stamina_total"),
        ),
        "resolve": _format_pool(
            _extract_input_value(html, "resolve_current"),
            _extract_input_value(html, "resolve_total"),
        ),
        "conditions": _extract_conditions(html),
        "eac": _extract_row_total(html, "ac_eac_miscmod", signed=False),
        "kac": _extract_row_total(html, "ac_kac_miscmod", signed=False),
        "fort": _extract_row_total(html, "saves_fortitude_basesave", signed=True),
        "ref": _extract_row_total(html, "saves_reflex_basesave", signed=True),
        "will": _extract_row_total(html, "saves_will_basesave", signed=True),
        "attack": _extract_attack_bonus(html),
        "weapon_name": UNAVAILABLE,
        "weapon_damage": UNAVAILABLE,
        "weapon_damage_type": UNAVAILABLE,
        "weapon_range": UNAVAILABLE,
        "weapon_ammo": UNAVAILABLE,
    }
    snapshot.update(_extract_equipped_weapon(html))
    return snapshot
