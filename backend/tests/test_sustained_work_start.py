"""The workday begins at sustained work, not at the first touch of the machine."""

from datetime import UTC, datetime, timedelta

from app.services.activity_timeline import sustained_work_start

IDLE_THRESHOLD = 10 * 60


def block(kind: str, start_minute: int, end_minute: int):
    base = datetime(2026, 7, 29, 5, 0, tzinfo=UTC)  # 08:00 Cairo
    return kind, base + timedelta(minutes=start_minute), base + timedelta(minutes=end_minute)


def test_a_brief_touch_before_hours_away_is_not_the_start_of_the_day():
    # ahmed hamamo, 2026-07-29: touched the machine 08:04, gone until 10:17.
    blocks = [
        block("worked", 4, 14),
        block("idle", 14, 137),
        block("worked", 137, 208),
        block("idle", 208, 208),
        block("worked", 208, 215),
    ]

    assert sustained_work_start(blocks, IDLE_THRESHOLD) == block("worked", 137, 208)[1]


def test_a_lunch_break_keeps_the_mornings_start():
    blocks = [
        block("worked", 0, 180),
        block("idle", 180, 210),
        block("worked", 210, 480),
    ]

    assert sustained_work_start(blocks, IDLE_THRESHOLD) == block("worked", 0, 180)[1]


def test_a_short_gap_keeps_the_first_block():
    blocks = [
        block("worked", 0, 5),
        block("idle", 5, 12),
        block("worked", 12, 300),
    ]

    assert sustained_work_start(blocks, IDLE_THRESHOLD) == block("worked", 0, 5)[1]


def test_the_last_block_wins_when_every_earlier_one_was_a_false_start():
    blocks = [
        block("worked", 0, 2),
        block("idle", 2, 120),
        block("worked", 120, 122),
        block("idle", 122, 240),
        block("worked", 240, 480),
    ]

    assert sustained_work_start(blocks, IDLE_THRESHOLD) == block("worked", 240, 480)[1]


def test_a_day_without_any_work_has_no_start():
    assert sustained_work_start([block("idle", 0, 120)], IDLE_THRESHOLD) is None
    assert sustained_work_start([], IDLE_THRESHOLD) is None


def test_a_single_work_block_is_always_the_start():
    blocks = [block("worked", 30, 35), block("idle", 35, 300)]

    assert sustained_work_start(blocks, IDLE_THRESHOLD) == block("worked", 30, 35)[1]
