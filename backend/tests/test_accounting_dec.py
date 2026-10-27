from decimal import Decimal

import pytest
from app.core.accounting import dec


@pytest.mark.parametrize("v,exp", [(None, "0.00"), (0, "0.00"), (1, "1.00"), (29.9, "29.90"), ("3.905", "3.91"), (2.675, "2.68"), (Decimal("0.004"), "0.00"), (-1.005, "-1.01")])
def test_dec_rounds_half_up_to_two_places(v, exp):
    assert dec(v) == Decimal(exp)


def test_dec_does_not_accumulate_float_error():
    assert sum(dec(0.1) for _ in range(10)) == Decimal("1.00")


def test_period_lock_blocks_entries_on_or_before_close_date():
    from app.core.accounting import _assert_period_open
    _assert_period_open(None, "2026-01-01", "x")
    _assert_period_open("2026-01-31", "2026-02-01", "x")
    with pytest.raises(RuntimeError):
        _assert_period_open("2026-01-31", "2026-01-31", "x")
    with pytest.raises(RuntimeError):
        _assert_period_open("2026-01-31", "2025-12-15", "x")
