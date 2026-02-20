"""Tests for RateLimitScheduler."""
from backend.shared.rate_limiter import RateLimitScheduler


def test_initial_interval():
    s = RateLimitScheduler("test", base_interval=5.0)
    assert s.current_interval == 5.0


def test_on_success_resets():
    s = RateLimitScheduler("test", base_interval=5.0)
    s.on_rate_limit()
    assert s.current_interval > 5.0
    s.on_success()
    assert s.current_interval == 5.0


def test_exponential_backoff():
    s = RateLimitScheduler(
        "test", base_interval=2.0, max_interval=300.0, jitter_factor=0.0
    )
    s.on_rate_limit()
    assert s.current_interval == 4.0
    s.on_rate_limit()
    assert s.current_interval == 8.0
    s.on_rate_limit()
    assert s.current_interval == 16.0


def test_max_interval_cap():
    s = RateLimitScheduler("test", base_interval=2.0, max_interval=10.0, jitter_factor=0.0)
    for _ in range(20):
        s.on_rate_limit()
    assert s.current_interval <= 10.0


def test_jitter_adds_randomness():
    s = RateLimitScheduler("test", base_interval=2.0, jitter_factor=0.3)
    intervals = set()
    for _ in range(10):
        s.on_rate_limit()
        intervals.add(round(s.current_interval, 2))
        s.reset()
        s.on_rate_limit()
    assert len(intervals) > 1


def test_reset():
    s = RateLimitScheduler("test", base_interval=5.0)
    s.on_rate_limit()
    s.on_rate_limit()
    s.reset()
    assert s.current_interval == 5.0
