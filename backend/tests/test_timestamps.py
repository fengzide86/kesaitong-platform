from datetime import UTC, datetime, timedelta, timezone

from core.timestamps import utc_iso, utc_now
from models import Feedback
from services.feedback_service import FeedbackService


def test_timestamp_preserves_utc_in_browser_contract():
    assert utc_iso(None) is None
    assert utc_iso(datetime(2026, 9, 21, 3, 30)) == "2026-09-21T03:30:00+00:00"
    assert utc_iso(datetime(2026, 9, 21, 11, 30, tzinfo=timezone(timedelta(hours=8)))) == "2026-09-21T03:30:00+00:00"
    now = utc_now()
    assert now.tzinfo is None
    assert abs((datetime.now(UTC).replace(tzinfo=None) - now).total_seconds()) < 2


def test_feedback_all_dates_include_timezone():
    stamp = datetime(2026, 9, 21, 3, 30)
    record = Feedback(title="问题", content="说明", created_at=stamp, updated_at=stamp, replied_at=stamp)
    data = FeedbackService(None)._serialize_feedback(record, detailed=True)
    for field in ("created_at", "updated_at", "replied_at"):
        assert data[field] == "2026-09-21T03:30:00+00:00"
