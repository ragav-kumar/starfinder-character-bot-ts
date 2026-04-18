"""Starfinder character bot entry point.

Implements guild-scoped character tracking, dashboard refresh, and polling for
the working prototype Discord bot. The runtime state intentionally stays in
memory only.
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, TypeAlias, cast

import fetcher

if TYPE_CHECKING:
    from discord import Interaction as DiscordInteraction
else:
    DiscordInteraction = Any

AsyncCallable: TypeAlias = Callable[..., Awaitable[Any]]
SummaryBuckets: TypeAlias = dict[str, list[str]]
DisplayFieldLabels: TypeAlias = tuple[tuple[str, str], ...]

DISPLAYED_FIELDS: DisplayFieldLabels = (
    ("name", "Name"),
    ("initiative", "Initiative"),
    ("hp", "HP"),
    ("stamina", "SP"),
    ("resolve", "RP"),
    ("conditions", "Conditions"),
    ("eac", "EAC"),
    ("kac", "KAC"),
    ("fort", "Fort"),
    ("ref", "Ref"),
    ("will", "Will"),
    ("attack", "Attack"),
    ("weapon_name", "Weapon"),
    ("weapon_damage", "Damage"),
    ("weapon_damage_type", "Damage type"),
    ("weapon_range", "Range"),
    ("weapon_ammo", "Ammo"),
)

bot: Any
discord_import_error: Exception | None = None

try:
    import discord
    from discord import app_commands
    from discord.ext import commands
except ModuleNotFoundError as exc:
    if exc.name != "audioop":
        raise
    discord = None  # type: ignore[assignment]
    app_commands = None  # type: ignore[assignment]
    commands = None  # type: ignore[assignment]
    discord_import_error = exc


@dataclass(slots=True)
class TrackedCharacter:
    """In-memory record for one tracked character panel."""

    character_id: str
    display_name: str
    panel_message_id: int | None = None
    panel_channel_id: int | None = None
    panel_message: Any | None = None
    stale: bool = False


def _new_tracked_map() -> dict[str, TrackedCharacter]:
    return {}


def _new_snapshot_map() -> dict[str, dict[str, str]]:
    return {}


@dataclass(slots=True)
class GuildState:
    """Per-guild runtime state for the prototype."""

    tracked: dict[str, TrackedCharacter] = field(default_factory=_new_tracked_map)
    tracking_enabled: bool = False
    polling_period_seconds: int = 60
    last_snapshots: dict[str, dict[str, str]] = field(default_factory=_new_snapshot_map)
    polling_task: asyncio.Task[Any] | Any | None = None


GUILD_STATES: dict[int, GuildState] = {}


def get_guild_state(guild_id: int) -> GuildState:
    """Return the runtime state bucket for *guild_id*."""
    return GUILD_STATES.setdefault(guild_id, GuildState())


def _get_guild_id(ctx: Any) -> int:
    guild = getattr(ctx, "guild", None)
    return int(getattr(guild, "id", 0) or 0)


def _get_channel_id(ctx: Any) -> int | None:
    channel = getattr(ctx, "channel", None)
    channel_id = getattr(channel, "id", None)
    return int(channel_id) if channel_id is not None else None


def _parse_character_ids(raw_value: str) -> tuple[list[str], list[str]]:
    """Split a raw character-ID argument into valid and invalid tokens."""
    valid: list[str] = []
    invalid: list[str] = []

    for token in raw_value.split():
        if token.isdigit():
            valid.append(token)
        else:
            invalid.append(token)

    return valid, invalid


def _display_name(character_id: str) -> str:
    """Return the Phase 1 placeholder display name for a tracked character."""
    return f"Character {character_id}"


def _render_placeholder_panel(record: TrackedCharacter) -> str:
    """Render the minimal Phase 1 dashboard panel content."""
    return (
        f"**{record.display_name}** (`ID: {record.character_id}`)\n"
        "Status: `Tracking added in Phase 1; detailed stats arrive in Phase 2.`"
    )


def _snapshot_value(snapshot: dict[str, str], key: str) -> str:
    """Return a panel-safe snapshot value with `Unavailable` fallback."""
    value = snapshot.get(key, "Unavailable").strip()
    return value or "Unavailable"


def _pad_cell(value: str, width: int, *, align: str = "left") -> str:
    """Pad one cell for monospace table rendering."""
    if align == "right":
        return value.rjust(width)
    if align == "center":
        return value.center(width)
    return value.ljust(width)


def _render_table(
    headers: tuple[str, ...],
    values: tuple[str, ...],
    *,
    min_widths: tuple[int, ...],
    aligns: tuple[str, ...],
) -> str:
    """Render a compact monospace table with aligned columns."""
    widths = [
        max(len(header), len(value), min_width)
        for header, value, min_width in zip(headers, values, min_widths, strict=False)
    ]
    header_row = " | ".join(
        _pad_cell(header, width, align=align)
        for header, width, align in zip(headers, widths, aligns, strict=False)
    )
    separator_row = "-| -".replace(" ", "").join("-" * width for width in widths)
    value_row = " | ".join(
        _pad_cell(value, width, align=align)
        for value, width, align in zip(values, widths, aligns, strict=False)
    )
    return "\n".join((header_row, separator_row, value_row))


def _render_character_panel(
    record: TrackedCharacter,
    snapshot: dict[str, str],
    *,
    stale: bool = False,
) -> str:
    """Render the approved compact dashboard panel in a monospace table layout."""
    refreshed_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    core_table = _render_table(
        ("Init", "HP", "SP", "RP"),
        (
            _snapshot_value(snapshot, "initiative"),
            _snapshot_value(snapshot, "hp"),
            _snapshot_value(snapshot, "stamina"),
            _snapshot_value(snapshot, "resolve"),
        ),
        min_widths=(4, 5, 5, 4),
        aligns=("right", "right", "right", "right"),
    )
    defense_table = _render_table(
        ("EAC", "KAC", "Fort", "Ref", "Will"),
        (
            _snapshot_value(snapshot, "eac"),
            _snapshot_value(snapshot, "kac"),
            _snapshot_value(snapshot, "fort"),
            _snapshot_value(snapshot, "ref"),
            _snapshot_value(snapshot, "will"),
        ),
        min_widths=(4, 4, 4, 3, 4),
        aligns=("right", "right", "right", "right", "right"),
    )
    weapon_table = _render_table(
        ("Attack", "Name", "Damage", "Type", "Range", "Ammo"),
        (
            _snapshot_value(snapshot, "attack"),
            _snapshot_value(snapshot, "weapon_name"),
            _snapshot_value(snapshot, "weapon_damage"),
            _snapshot_value(snapshot, "weapon_damage_type"),
            _snapshot_value(snapshot, "weapon_range"),
            _snapshot_value(snapshot, "weapon_ammo"),
        ),
        min_widths=(6, 12, 10, 9, 5, 11),
        aligns=("right", "left", "left", "left", "left", "left"),
    )
    conditions = _snapshot_value(snapshot, "conditions")
    if conditions == "Unavailable":
        conditions = "None"

    footer_lines: list[str] = []
    if stale:
        footer_lines.append("⚠️ **STALE** — last refresh failed; showing the previous successful data.")
    footer_lines.append(f"_Last updated: {refreshed_at}_")
    footer = "\n".join(footer_lines)

    return (
        f"**{record.display_name}** (`ID: {record.character_id}`)\n\n"
        "```text\n"
        f"{core_table}\n"
        f"Conditions: {conditions}\n\n"
        f"{defense_table}\n\n"
        f"{weapon_table}\n"
        "```\n"
        f"{footer}"
    )


async def _safe_delete_message(message: Any | None) -> None:
    """Delete a message if it supports async deletion; ignore cleanup failures."""
    if message is None:
        return

    delete = cast(AsyncCallable | None, getattr(message, "delete", None))
    if delete is None or not callable(delete):
        return

    try:
        await delete()
    except Exception:
        return


async def _send_panel_message(target: Any, message: str) -> Any:
    """Send a persistent panel message to the current channel."""
    send = cast(AsyncCallable | None, getattr(target, "send", None))
    if send is not None and callable(send):
        return await send(message)

    channel = getattr(target, "channel", None)
    channel_send = cast(AsyncCallable | None, getattr(channel, "send", None))
    if channel_send is not None and callable(channel_send):
        return await channel_send(message)

    raise RuntimeError("Target does not support channel message sending")


async def _send_ack(target: Any, message: str, *, ephemeral: bool = False) -> Any:
    """Send a command acknowledgement for either a context or slash interaction."""
    send = cast(AsyncCallable | None, getattr(target, "send", None))
    if send is not None and callable(send):
        return await send(message)

    response = getattr(target, "response", None)
    if response is not None:
        is_done = cast(Callable[[], bool] | None, getattr(response, "is_done", None))
        send_message = cast(AsyncCallable | None, getattr(response, "send_message", None))
        if send_message is not None and callable(send_message):
            if is_done is None or not is_done():
                return await send_message(message, ephemeral=ephemeral)

    followup = getattr(target, "followup", None)
    followup_send = cast(AsyncCallable | None, getattr(followup, "send", None))
    if followup_send is not None and callable(followup_send):
        return await followup_send(message, ephemeral=ephemeral)

    raise RuntimeError("Target does not support acknowledgement sending")


async def _send_temporary_ack(target: Any, message: str, *, ephemeral: bool = False) -> Any:
    """Send an acknowledgement that should disappear after the action completes."""
    notice = await _send_ack(target, message, ephemeral=ephemeral)
    await _safe_delete_message(notice)
    return notice


async def _safe_edit_message(message: Any | None, content: str) -> bool:
    """Edit a message in place when possible; ignore update failures."""
    if message is None:
        return False

    edit = cast(AsyncCallable | None, getattr(message, "edit", None))
    if edit is None or not callable(edit):
        return False

    try:
        await edit(content=content)
    except TypeError:
        try:
            await edit(content)
        except Exception:
            return False
    except Exception:
        return False
    return True


def _dashboard_channel_id(state: GuildState) -> int | None:
    """Return the configured dashboard channel ID for this guild, when known."""
    for record in state.tracked.values():
        if record.panel_channel_id is not None:
            return record.panel_channel_id
    return None


def _diff_snapshots(previous: dict[str, str] | None, current: dict[str, str]) -> list[str]:
    """Return short human-readable change summaries for dashboard-visible fields."""
    if not previous:
        return []

    changes: list[str] = []
    for key, label in DISPLAYED_FIELDS:
        old_value = _snapshot_value(previous, key)
        new_value = _snapshot_value(current, key)
        if old_value != new_value:
            changes.append(f"{label} changed {old_value} → {new_value}")
    return changes


async def _send_temporary_dashboard_notice(record: TrackedCharacter, message: str) -> None:
    """Post a short-lived change notice in the dashboard channel when available."""
    panel_message = record.panel_message
    channel = getattr(panel_message, "channel", None)
    send = cast(AsyncCallable | None, getattr(channel, "send", None))
    if send is None or not callable(send):
        return

    try:
        notice = await send(message)
    except Exception:
        return

    await _safe_delete_message(notice)


def _cancel_polling_task(state: GuildState) -> None:
    """Cancel and clear the guild's background polling task, if any."""
    task = state.polling_task
    if task is not None:
        cancel = getattr(task, "cancel", None)
        if callable(cancel):
            cancel()
    state.polling_task = None


async def _poll_guild_characters(guild_id: int) -> None:
    """Background loop that refreshes tracked characters on the configured interval."""
    try:
        while True:
            state = get_guild_state(guild_id)
            if not state.tracking_enabled:
                return

            await asyncio.sleep(max(1, state.polling_period_seconds))

            state = get_guild_state(guild_id)
            if not state.tracking_enabled:
                return
            if not state.tracked:
                continue

            await _refresh_tracked_characters(
                None,
                state=state,
                user_triggered=False,
                announce_changes=True,
            )
    except asyncio.CancelledError:
        raise


def _start_polling_task(guild_id: int) -> Any:
    """Create the background polling task while staying test-friendly."""
    poller = _poll_guild_characters(guild_id)
    task = asyncio.create_task(poller)
    if not isinstance(task, asyncio.Task):
        poller.close()
    return task


async def _refresh_tracked_characters(
    target: Any | None,
    *,
    state: GuildState,
    user_triggered: bool,
    announce_changes: bool,
) -> tuple[list[str], list[str], bool]:
    """Refresh every tracked character once and update panels in place as needed."""
    change_summaries: list[str] = []
    failures: list[str] = []
    panel_updated = False

    for character_id, record in state.tracked.items():
        previous_snapshot = state.last_snapshots.get(character_id)

        try:
            url = fetcher.build_character_url(character_id)
            html = await fetcher.fetch(url)
            snapshot = fetcher.scrape_character_sheet(html, character_id=character_id)
        except Exception:
            if previous_snapshot is not None and not record.stale:
                record.stale = True
                if await _safe_edit_message(
                    record.panel_message,
                    _render_character_panel(record, previous_snapshot, stale=True),
                ):
                    panel_updated = True
            failures.append(f"{record.display_name} ({character_id})")
            continue

        if snapshot.get("name"):
            record.display_name = snapshot["name"]

        changes = _diff_snapshots(previous_snapshot, snapshot)
        was_stale = record.stale
        record.stale = False
        state.last_snapshots[character_id] = snapshot

        rendered_panel = _render_character_panel(record, snapshot, stale=False)
        if record.panel_message is None and target is not None:
            panel_message = await _send_panel_message(target, rendered_panel)
            record.panel_message = panel_message
            record.panel_message_id = getattr(panel_message, "id", None)
            record.panel_channel_id = _get_channel_id(target)
            panel_updated = True
        else:
            if await _safe_edit_message(record.panel_message, rendered_panel):
                panel_updated = True

        for change in changes:
            summary = f"{record.display_name}: {change}"
            change_summaries.append(summary)
            if announce_changes and not user_triggered:
                await _send_temporary_dashboard_notice(record, summary)

    return change_summaries, failures, panel_updated


def _build_summary(parts: SummaryBuckets) -> str:
    """Create a concise user acknowledgement from per-status results."""
    ordered_labels = ("Added", "Already tracked", "Failed")
    lines = [f"{label}: {', '.join(parts[label])}" for label in ordered_labels if parts[label]]
    return " | ".join(lines) if lines else "No character IDs were provided."


async def characters_add_impl(target: Any, *, character_ids: str) -> None:
    """Track one or more numeric character IDs for the current guild."""
    state = get_guild_state(_get_guild_id(target))
    valid_ids, invalid_ids = _parse_character_ids(character_ids)
    summary: SummaryBuckets = {"Added": [], "Already tracked": [], "Failed": []}

    for bad_id in invalid_ids:
        summary["Failed"].append(f"{bad_id} (character IDs must be numeric)")

    for character_id in valid_ids:
        existing = state.tracked.get(character_id)
        if existing is not None:
            summary["Already tracked"].append(
                f"{existing.display_name} ({character_id})"
            )
            continue

        try:
            url = fetcher.build_character_url(character_id)
            html = await fetcher.fetch(url)
            snapshot = fetcher.scrape_character_sheet(html, character_id=character_id)
        except Exception:
            summary["Failed"].append(f"{character_id} (page not reachable)")
            continue

        record = TrackedCharacter(
            character_id=character_id,
            display_name=snapshot.get("name") or _display_name(character_id),
        )
        panel_message = await _send_panel_message(target, _render_character_panel(record, snapshot))
        record.panel_message = panel_message
        record.panel_message_id = getattr(panel_message, "id", None)
        record.panel_channel_id = _get_channel_id(target)
        state.tracked[character_id] = record
        state.last_snapshots[character_id] = snapshot
        summary["Added"].append(f"{record.display_name} ({character_id})")

    await _send_ack(target, _build_summary(summary), ephemeral=hasattr(target, "response"))


async def characters_remove_impl(target: Any, *, character_id: str) -> None:
    """Remove a tracked character from the current guild."""
    if not character_id.isdigit():
        await _send_ack(
            target,
            f"Failed: {character_id} (character IDs must be numeric)",
            ephemeral=hasattr(target, "response"),
        )
        return

    state = get_guild_state(_get_guild_id(target))
    record = state.tracked.pop(character_id, None)
    if record is None:
        await _send_ack(target, f"Not tracked: {character_id}", ephemeral=hasattr(target, "response"))
        return

    state.last_snapshots.pop(character_id, None)
    await _safe_delete_message(record.panel_message)
    await _send_ack(
        target,
        f"Removed: {record.display_name} ({character_id})",
        ephemeral=hasattr(target, "response"),
    )


async def characters_clear_impl(target: Any) -> None:
    """Clear all tracked characters and stop automatic tracking for this guild."""
    state = get_guild_state(_get_guild_id(target))
    tracked_records = list(state.tracked.values())

    for record in tracked_records:
        await _safe_delete_message(record.panel_message)

    cleared_count = len(tracked_records)
    state.tracked.clear()
    state.last_snapshots.clear()
    state.tracking_enabled = False
    state.polling_period_seconds = 60
    _cancel_polling_task(state)

    await _send_ack(
        target,
        f"Cleared {cleared_count} tracked character(s). Automatic tracking stopped.",
        ephemeral=hasattr(target, "response"),
    )


async def characters_list_impl(target: Any) -> None:
    """Show the current tracked-character registry for this guild."""
    state = get_guild_state(_get_guild_id(target))
    tracked_records = list(state.tracked.values())

    if not tracked_records:
        await _send_ack(
            target,
            "No characters are currently being tracked.",
            ephemeral=hasattr(target, "response"),
        )
        return

    entries = [
        f"{record.display_name} ({record.character_id})"
        for record in tracked_records
    ]
    await _send_ack(
        target,
        f"Tracked characters: {', '.join(entries)}",
        ephemeral=hasattr(target, "response"),
    )


async def characters_refresh_impl(target: Any) -> None:
    """Run one manual refresh cycle for the current guild's dashboard."""
    state = get_guild_state(_get_guild_id(target))
    if not state.tracked:
        await _send_temporary_ack(
            target,
            "No characters are currently being tracked.",
            ephemeral=hasattr(target, "response"),
        )
        return

    dashboard_channel_id = _dashboard_channel_id(state)
    current_channel_id = _get_channel_id(target)
    if dashboard_channel_id is not None and current_channel_id not in (None, dashboard_channel_id):
        await _send_ack(
            target,
            f"/characters refresh only works in the dashboard channel (<#{dashboard_channel_id}>).",
            ephemeral=hasattr(target, "response"),
        )
        return

    change_summaries, failures, panel_updated = await _refresh_tracked_characters(
        target,
        state=state,
        user_triggered=True,
        announce_changes=False,
    )

    if failures:
        status = f"Refresh complete with failures: {', '.join(failures)}"
    elif change_summaries:
        preview = "; ".join(change_summaries[:3])
        if len(change_summaries) > 3:
            preview += "; ..."
        status = f"Refresh complete: {preview}"
    elif panel_updated:
        status = "Refresh complete."
    else:
        status = "No changes found."

    await _send_temporary_ack(target, status, ephemeral=hasattr(target, "response"))


async def characters_tracking_start_impl(target: Any, polling_period: int | str | None = None) -> None:
    """Start or restart automatic polling for this guild."""
    state = get_guild_state(_get_guild_id(target))
    interval = state.polling_period_seconds or 60

    if polling_period is not None:
        try:
            interval = int(polling_period)
        except (TypeError, ValueError):
            await _send_ack(
                target,
                "Failed: pollingPeriod must be a positive integer number of seconds.",
                ephemeral=hasattr(target, "response"),
            )
            return

        if interval <= 0:
            await _send_ack(
                target,
                "Failed: pollingPeriod must be a positive integer number of seconds.",
                ephemeral=hasattr(target, "response"),
            )
            return

    if not state.tracked:
        await _send_ack(
            target,
            "Tracking not started: there is nothing to poll yet.",
            ephemeral=hasattr(target, "response"),
        )
        return

    if state.tracking_enabled:
        if polling_period is None or interval == state.polling_period_seconds:
            await _send_ack(
                target,
                f"Automatic tracking is already ongoing every {state.polling_period_seconds} seconds.",
                ephemeral=hasattr(target, "response"),
            )
            return

        _cancel_polling_task(state)
        state.polling_period_seconds = interval
        state.tracking_enabled = True
        state.polling_task = _start_polling_task(_get_guild_id(target))
        await _send_ack(
            target,
            f"Automatic tracking restarted with a {interval}-second polling period.",
            ephemeral=hasattr(target, "response"),
        )
        return

    state.polling_period_seconds = interval
    state.tracking_enabled = True
    state.polling_task = _start_polling_task(_get_guild_id(target))
    await _send_ack(
        target,
        f"Automatic tracking started with a {interval}-second polling period.",
        ephemeral=hasattr(target, "response"),
    )


async def characters_tracking_stop_impl(target: Any) -> None:
    """Stop automatic polling for this guild without removing the panels."""
    state = get_guild_state(_get_guild_id(target))
    state.tracking_enabled = False
    _cancel_polling_task(state)
    await _send_ack(
        target,
        "Automatic tracking has stopped.",
        ephemeral=hasattr(target, "response"),
    )


if commands is not None and discord is not None and app_commands is not None:
    intents = discord.Intents.default()

    discord_bot = commands.Bot(command_prefix=commands.when_mentioned, intents=intents)
    bot = discord_bot

    @discord_bot.event
    async def on_ready() -> None:
        try:
            await discord_bot.tree.sync()
        except Exception:
            pass

        user = discord_bot.user
        user_id = getattr(user, "id", "unknown")
        print(f"Logged in as {user} (id: {user_id})")

    characters_group = app_commands.Group(
        name="characters",
        description="Manage the tracked Starfinder characters for this server.",
    )

    @characters_group.command(name="add", description="Add one or more character IDs to tracking.")
    @app_commands.describe(character_ids="One or more numeric IDs separated by spaces")
    async def characters_add(interaction: DiscordInteraction, character_ids: str) -> None:
        await characters_add_impl(interaction, character_ids=character_ids)

    @characters_group.command(name="remove", description="Remove one tracked character ID.")
    @app_commands.describe(character_id="The numeric character ID to stop tracking")
    async def characters_remove(interaction: DiscordInteraction, character_id: str) -> None:
        await characters_remove_impl(interaction, character_id=character_id)

    @characters_group.command(name="clear", description="Clear all tracked characters for this server.")
    async def characters_clear(interaction: DiscordInteraction) -> None:
        await characters_clear_impl(interaction)

    @characters_group.command(name="list", description="List the tracked character names and IDs.")
    async def characters_list(interaction: DiscordInteraction) -> None:
        await characters_list_impl(interaction)

    @characters_group.command(name="refresh", description="Refresh the tracked character dashboard now.")
    async def characters_refresh(interaction: DiscordInteraction) -> None:
        await characters_refresh_impl(interaction)

    tracking_group = app_commands.Group(
        name="tracking",
        description="Manage automatic dashboard polling.",
        parent=characters_group,
    )

    @tracking_group.command(name="start", description="Start automatic character polling.")
    @app_commands.describe(polling_period="Optional polling period in seconds")
    async def characters_tracking_start(
        interaction: DiscordInteraction,
        polling_period: int | None = None,
    ) -> None:
        await characters_tracking_start_impl(interaction, polling_period=polling_period)

    @tracking_group.command(name="stop", description="Stop automatic character polling.")
    async def characters_tracking_stop(interaction: DiscordInteraction) -> None:
        await characters_tracking_stop_impl(interaction)

    discord_bot.tree.add_command(characters_group)
else:
    class _FallbackBot:
        """Small test-friendly stand-in used when discord.py cannot import."""

        user = "discord-unavailable"

        def run(self, token: str) -> None:
            raise RuntimeError(
                "discord.py could not be imported in this environment. "
                "Use Python 3.12 for runtime execution."
            ) from discord_import_error

    bot = _FallbackBot()


if __name__ == "__main__":
    token = os.environ["DISCORD_BOT_TOKEN"]
    bot.run(token)
