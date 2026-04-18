"""Tests for the bot command handlers and Phase 4 polish behavior."""

from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import bot


@dataclass
class FakeMessage:
    id: int
    content: str
    deleted: bool = False
    edit_count: int = 0
    channel: Any | None = None

    async def delete(self) -> None:
        self.deleted = True

    async def edit(self, *, content: str) -> None:
        self.content = content
        self.edit_count += 1


@dataclass
class FakeTask:
    cancelled: bool = False

    def cancel(self) -> None:
        self.cancelled = True


def _make_ctx(
    channel_messages: list[str] | None = None,
    *,
    guild_id: int = 1,
    channel_id: int = 100,
    sent_messages: list[FakeMessage] | None = None,
) -> MagicMock:
    """Return a minimal mock Context that records sent messages."""
    if channel_messages is None:
        channel_messages = []
    if sent_messages is None:
        sent_messages = []

    ctx = MagicMock()
    ctx.guild = MagicMock(id=guild_id)
    ctx.channel = MagicMock(id=channel_id)

    async def _send(message: str, **kwargs) -> FakeMessage:
        channel_messages.append(message)
        sent = FakeMessage(id=len(channel_messages), content=message, channel=ctx.channel)
        sent_messages.append(sent)
        return sent

    ctx.send = AsyncMock(side_effect=_send)
    ctx.channel.send = AsyncMock(side_effect=_send)
    return ctx


def _snapshot_for(character_id: str) -> dict[str, str]:
    """Return a simple scraped snapshot for offline command tests."""
    return {
        "name": f"Character {character_id}",
        "initiative": "+0",
        "hp": "1/1",
        "stamina": "1/1",
        "resolve": "1/1",
        "conditions": "Unavailable",
        "eac": "10",
        "kac": "10",
        "fort": "+0",
        "ref": "+0",
        "will": "+0",
        "attack": "+0",
        "weapon_name": "Unavailable",
        "weapon_damage": "Unavailable",
        "weapon_damage_type": "Unavailable",
        "weapon_range": "Unavailable",
        "weapon_ammo": "Unavailable",
    }


@contextmanager
def _patched_character_scrape():
    """Mock the network/scrape boundary so tests remain fully offline."""

    def _scrape(_html: str, *, character_id: str) -> dict[str, str]:
        return _snapshot_for(character_id)

    with (
        patch("bot.fetcher.fetch", new=AsyncMock(return_value="<html></html>")),
        patch("bot.fetcher.scrape_character_sheet", side_effect=_scrape),
    ):
        yield


@pytest.fixture(autouse=True)
def clear_guild_state():
    """Reset in-memory bot state between tests."""
    bot.GUILD_STATES.clear()


class TestCharactersAdd:
    async def test_add_tracks_ids_and_creates_placeholder_panels(self):
        messages: list[str] = []
        ctx = _make_ctx(messages, guild_id=101, channel_id=999)

        with _patched_character_scrape():
            await bot.characters_add_impl(ctx, character_ids="110 245")

        state = bot.get_guild_state(101)
        assert set(state.tracked.keys()) == {"110", "245"}
        assert state.tracked["110"].panel_message_id is not None
        assert any("Added:" in message for message in messages)

    async def test_add_reports_duplicates_and_invalid_ids(self):
        messages: list[str] = []
        ctx = _make_ctx(messages, guild_id=202)

        with _patched_character_scrape():
            await bot.characters_add_impl(ctx, character_ids="110")
            await bot.characters_add_impl(ctx, character_ids="110 abc 245")

        state = bot.get_guild_state(202)
        assert set(state.tracked.keys()) == {"110", "245"}
        assert any("Already tracked:" in message for message in messages)
        assert any("Failed:" in message and "abc" in message for message in messages)

    async def test_add_state_is_scoped_per_guild(self):
        first_ctx = _make_ctx(guild_id=1)
        second_ctx = _make_ctx(guild_id=2)

        with _patched_character_scrape():
            await bot.characters_add_impl(first_ctx, character_ids="110")
            await bot.characters_add_impl(second_ctx, character_ids="245")

        assert set(bot.get_guild_state(1).tracked.keys()) == {"110"}
        assert set(bot.get_guild_state(2).tracked.keys()) == {"245"}

    async def test_add_scrapes_snapshot_and_posts_detailed_panel(self):
        messages: list[str] = []
        ctx = _make_ctx(messages, guild_id=606, channel_id=321)
        snapshot = {
            "name": "Paul-Paul Atreides",
            "initiative": "+4",
            "hp": "7/7",
            "stamina": "5/5",
            "resolve": "5/5",
            "conditions": "Unavailable",
            "eac": "15",
            "kac": "16",
            "fort": "+0",
            "ref": "+6",
            "will": "+0",
            "attack": "+4",
            "weapon_name": "Laser Pistol",
            "weapon_damage": "1d4 + LEV",
            "weapon_damage_type": "Burn 1d4",
            "weapon_range": "80 ft",
            "weapon_ammo": "52 / 1-20",
        }

        with (
            patch("bot.fetcher.fetch", new=AsyncMock(return_value="<html></html>")),
            patch("bot.fetcher.scrape_character_sheet", return_value=snapshot),
        ):
            await bot.characters_add_impl(ctx, character_ids="110")

        state = bot.get_guild_state(606)
        assert state.tracked["110"].display_name == "Paul-Paul Atreides"
        assert state.last_snapshots["110"] == snapshot

        panel_message = next(message for message in messages if "Paul-Paul Atreides" in message)
        assert "```text" in panel_message
        assert "Init |" in panel_message
        assert "Conditions: None" in panel_message
        assert "EAC |  KAC | Fort | Ref | Will" in panel_message
        assert "Attack | Name" in panel_message
        assert "Laser Pistol" in panel_message


class TestCharactersRemove:
    async def test_remove_deletes_existing_panel_and_updates_state(self):
        messages: list[str] = []
        ctx = _make_ctx(messages, guild_id=303)
        with _patched_character_scrape():
            await bot.characters_add_impl(ctx, character_ids="110")

        tracked = bot.get_guild_state(303).tracked["110"]
        panel_message = tracked.panel_message

        await bot.characters_remove_impl(ctx, character_id="110")

        assert "110" not in bot.get_guild_state(303).tracked
        assert panel_message is not None and panel_message.deleted is True
        assert any("Removed:" in message for message in messages)

    async def test_remove_reports_untracked_id(self):
        messages: list[str] = []
        ctx = _make_ctx(messages, guild_id=404)

        await bot.characters_remove_impl(ctx, character_id="999")

        assert any("Not tracked:" in message for message in messages)


class TestCharactersClear:
    async def test_clear_removes_all_characters_and_stops_tracking(self):
        messages: list[str] = []
        ctx = _make_ctx(messages, guild_id=505)

        with _patched_character_scrape():
            await bot.characters_add_impl(ctx, character_ids="110 245")
        state = bot.get_guild_state(505)
        state.tracking_enabled = True
        state.polling_task = FakeTask()

        panels = [record.panel_message for record in state.tracked.values()]
        await bot.characters_clear_impl(ctx)

        assert state.tracked == {}
        assert state.tracking_enabled is False
        assert state.polling_task is None
        assert all(panel is not None and panel.deleted is True for panel in panels)
        assert any("Cleared" in message for message in messages)


class TestCharactersList:
    async def test_list_reports_empty_registry(self):
        messages: list[str] = []
        ctx = _make_ctx(messages, guild_id=707)

        await bot.characters_list_impl(ctx)

        assert messages[-1] == "No characters are currently being tracked."

    async def test_list_shows_tracked_character_names_and_ids(self):
        messages: list[str] = []
        ctx = _make_ctx(messages, guild_id=808)

        with _patched_character_scrape():
            await bot.characters_add_impl(ctx, character_ids="110 245")

        await bot.characters_list_impl(ctx)

        summary = messages[-1]
        assert summary.startswith("Tracked characters:")
        assert "Character 110 (110)" in summary
        assert "Character 245 (245)" in summary

    async def test_list_is_scoped_per_guild(self):
        first_ctx = _make_ctx(guild_id=1)
        second_messages: list[str] = []
        second_ctx = _make_ctx(second_messages, guild_id=2)

        with _patched_character_scrape():
            await bot.characters_add_impl(first_ctx, character_ids="110")

        await bot.characters_list_impl(second_ctx)

        assert second_messages[-1] == "No characters are currently being tracked."


class TestCharactersRefresh:
    async def test_refresh_updates_existing_panel_in_place_and_deletes_ack(self):
        messages: list[str] = []
        sent_messages: list[FakeMessage] = []
        ctx = _make_ctx(messages, guild_id=909, channel_id=123, sent_messages=sent_messages)

        with _patched_character_scrape():
            await bot.characters_add_impl(ctx, character_ids="110")

        refreshed_snapshot = {
            **_snapshot_for("110"),
            "hp": "0/7",
            "conditions": "Prone",
        }
        with (
            patch("bot.fetcher.fetch", new=AsyncMock(return_value="<html>updated</html>")),
            patch("bot.fetcher.scrape_character_sheet", return_value=refreshed_snapshot),
        ):
            await bot.characters_refresh_impl(ctx)

        panel_message = bot.get_guild_state(909).tracked["110"].panel_message
        assert panel_message is not None
        assert panel_message.edit_count == 1
        assert "0/7" in panel_message.content
        assert "Prone" in panel_message.content
        assert any(message.deleted for message in sent_messages[1:])

    async def test_refresh_re_renders_panel_even_when_snapshot_is_unchanged(self):
        messages: list[str] = []
        ctx = _make_ctx(messages, guild_id=912, channel_id=444)

        with _patched_character_scrape():
            await bot.characters_add_impl(ctx, character_ids="110")

        panel_message = bot.get_guild_state(912).tracked["110"].panel_message
        assert panel_message is not None

        with (
            patch("bot.fetcher.fetch", new=AsyncMock(return_value="<html>same</html>")),
            patch("bot.fetcher.scrape_character_sheet", return_value=_snapshot_for("110")),
        ):
            await bot.characters_refresh_impl(ctx)

        assert panel_message.edit_count == 1
        assert "_Last updated:" in panel_message.content

    async def test_refresh_rejects_wrong_channel(self):
        setup_ctx = _make_ctx(guild_id=910, channel_id=500)
        refresh_messages: list[str] = []
        refresh_ctx = _make_ctx(refresh_messages, guild_id=910, channel_id=999)

        with _patched_character_scrape():
            await bot.characters_add_impl(setup_ctx, character_ids="110")

        await bot.characters_refresh_impl(refresh_ctx)

        assert "dashboard channel" in refresh_messages[-1].lower()

    async def test_refresh_marks_panel_stale_after_failed_fetch(self):
        messages: list[str] = []
        ctx = _make_ctx(messages, guild_id=911, channel_id=321)

        with _patched_character_scrape():
            await bot.characters_add_impl(ctx, character_ids="110")

        with patch("bot.fetcher.fetch", new=AsyncMock(side_effect=RuntimeError("boom"))):
            await bot.characters_refresh_impl(ctx)

        panel_message = bot.get_guild_state(911).tracked["110"].panel_message
        assert panel_message is not None
        assert "STALE" in panel_message.content
        assert bot.get_guild_state(911).last_snapshots["110"]["hp"] == "1/1"

    async def test_refresh_clears_stale_marker_after_successful_recovery(self):
        messages: list[str] = []
        ctx = _make_ctx(messages, guild_id=913, channel_id=321)

        with _patched_character_scrape():
            await bot.characters_add_impl(ctx, character_ids="110")

        with patch("bot.fetcher.fetch", new=AsyncMock(side_effect=RuntimeError("boom"))):
            await bot.characters_refresh_impl(ctx)

        recovered_snapshot = {
            **_snapshot_for("110"),
            "hp": "3/7",
            "conditions": "Off-kilter",
        }
        with (
            patch("bot.fetcher.fetch", new=AsyncMock(return_value="<html>recovered</html>")),
            patch("bot.fetcher.scrape_character_sheet", return_value=recovered_snapshot),
        ):
            await bot.characters_refresh_impl(ctx)

        state = bot.get_guild_state(913)
        panel_message = state.tracked["110"].panel_message
        assert panel_message is not None
        assert state.tracked["110"].stale is False
        assert "STALE" not in panel_message.content
        assert "3/7" in panel_message.content
        assert "Off-kilter" in panel_message.content

    async def test_automatic_refresh_posts_temporary_change_notices(self):
        messages: list[str] = []
        sent_messages: list[FakeMessage] = []
        ctx = _make_ctx(messages, guild_id=914, channel_id=654, sent_messages=sent_messages)

        with _patched_character_scrape():
            await bot.characters_add_impl(ctx, character_ids="110")

        state = bot.get_guild_state(914)
        updated_snapshot = {
            **_snapshot_for("110"),
            "hp": "0/7",
            "conditions": "Prone",
        }
        with (
            patch("bot.fetcher.fetch", new=AsyncMock(return_value="<html>updated</html>")),
            patch("bot.fetcher.scrape_character_sheet", return_value=updated_snapshot),
        ):
            change_summaries, failures, panel_updated = await bot._refresh_tracked_characters(
                None,
                state=state,
                user_triggered=False,
                announce_changes=True,
            )

        assert failures == []
        assert panel_updated is True
        assert any("HP changed 1/1 → 0/7" in summary for summary in change_summaries)
        notice_messages = [
            message for message in sent_messages[1:] if "Character 110:" in message.content
        ]
        assert notice_messages
        assert all(message.deleted is True for message in notice_messages)


class TestCharactersTracking:
    async def test_tracking_start_reports_empty_registry(self):
        messages: list[str] = []
        ctx = _make_ctx(messages, guild_id=1001)

        await bot.characters_tracking_start_impl(ctx)

        state = bot.get_guild_state(1001)
        assert state.tracking_enabled is False
        assert "nothing to poll" in messages[-1].lower()

    async def test_tracking_start_and_stop_manage_task_lifecycle(self):
        messages: list[str] = []
        ctx = _make_ctx(messages, guild_id=1002)

        with _patched_character_scrape():
            await bot.characters_add_impl(ctx, character_ids="110")

        created_task = FakeTask()
        with patch("bot.asyncio.create_task", return_value=created_task):
            await bot.characters_tracking_start_impl(ctx, polling_period=30)

        state = bot.get_guild_state(1002)
        assert state.tracking_enabled is True
        assert state.polling_period_seconds == 30
        assert state.polling_task is created_task

        await bot.characters_tracking_stop_impl(ctx)

        assert state.tracking_enabled is False
        assert state.polling_task is None
        assert created_task.cancelled is True
        assert any("stopped" in message.lower() for message in messages)

    async def test_tracking_start_restarts_when_new_period_is_requested(self):
        messages: list[str] = []
        ctx = _make_ctx(messages, guild_id=1003)

        with _patched_character_scrape():
            await bot.characters_add_impl(ctx, character_ids="110")

        first_task = FakeTask()
        second_task = FakeTask()
        with patch("bot.asyncio.create_task", side_effect=[first_task, second_task]):
            await bot.characters_tracking_start_impl(ctx, polling_period=60)
            await bot.characters_tracking_start_impl(ctx, polling_period=15)

        state = bot.get_guild_state(1003)
        assert first_task.cancelled is True
        assert state.polling_task is second_task
        assert state.polling_period_seconds == 15
        assert any("restarted" in message.lower() for message in messages)
