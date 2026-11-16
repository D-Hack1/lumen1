"""UTC ISO-8601 and SPICE ephemeris-time helpers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta


def parse_utc(value: str) -> datetime:
    """Parse an ISO-8601 UTC timestamp, accepting a trailing ``Z``."""
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise ValueError("UTC timestamp must include an offset or Z")
    return parsed.astimezone(UTC)


def format_utc(value: datetime, *, timespec: str = "seconds") -> str:
    """Format a timezone-aware timestamp as an ISO-8601 UTC string."""
    if value.tzinfo is None:
        raise ValueError("datetime must be timezone-aware")
    return value.astimezone(UTC).isoformat(timespec=timespec).replace("+00:00", "Z")


def utc_to_et(value: str | datetime) -> float:
    """Convert UTC to SPICE ephemeris time; required kernels must be loaded."""
    import spiceypy as spice

    utc = value if isinstance(value, str) else format_utc(value)
    return float(spice.str2et(utc))


def et_to_utc(et: float, *, precision: int = 3) -> str:
    """Convert SPICE ephemeris time to ISO-8601 UTC."""
    import spiceypy as spice

    return spice.et2utc(et, "ISOC", precision) + "Z"


def ephemeris_index_to_utc(start_utc: str | datetime, index: int, step_seconds: int = 3600) -> str:
    """Return the UTC node timestamp at an ephemeris grid index."""
    start = parse_utc(start_utc) if isinstance(start_utc, str) else start_utc.astimezone(UTC)
    return format_utc(start + timedelta(seconds=index * step_seconds))


def utc_to_ephemeris_index(start_utc: str | datetime, value: str | datetime, step_seconds: int = 3600) -> int:
    """Return the exact hourly-grid index for a UTC timestamp."""
    start = parse_utc(start_utc) if isinstance(start_utc, str) else start_utc.astimezone(UTC)
    instant = parse_utc(value) if isinstance(value, str) else value.astimezone(UTC)
    seconds = (instant - start).total_seconds()
    if seconds % step_seconds:
        raise ValueError("timestamp is not on the ephemeris grid")
    return int(seconds // step_seconds)
