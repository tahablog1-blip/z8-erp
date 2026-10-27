import base64
from datetime import datetime, timezone

import pytest
from app.core.zatca import generate_qr_tlv, tlv


def decode(b64: str) -> dict[int, str]:
    raw, out, i = base64.b64decode(b64), {}, 0
    while i < len(raw):
        tag, ln = raw[i], raw[i + 1]
        out[tag] = raw[i + 2:i + 2 + ln].decode("utf-8")
        i += 2 + ln
    return out


def test_phase1_tags_roundtrip():
    q = generate_qr_tlv(seller_name="شركة مصدر الزيوت", vat_number="311832965900003", timestamp=datetime(2026, 10, 26, 10, 30, tzinfo=timezone.utc),
                        total_with_vat=29.9, vat_total=3.9)
    assert decode(q) == {1: "شركة مصدر الزيوت", 2: "311832965900003", 3: "2026-10-26T10:30:00Z", 4: "29.90", 5: "3.90"}


def test_naive_timestamp_is_treated_as_utc_and_offset_converted():
    a = decode(generate_qr_tlv(seller_name="x", vat_number="1", timestamp=datetime(2026, 1, 1, 12, 0), total_with_vat=1, vat_total=0))
    assert a[3] == "2026-01-01T12:00:00Z"
    from datetime import timedelta
    b = decode(generate_qr_tlv(seller_name="x", vat_number="1", timestamp=datetime(2026, 1, 1, 15, 0, tzinfo=timezone(timedelta(hours=3))), total_with_vat=1, vat_total=0))
    assert b[3] == "2026-01-01T12:00:00Z"


def test_amounts_use_two_decimals():
    d = decode(generate_qr_tlv(seller_name="x", vat_number="1", timestamp=datetime(2026, 1, 1, tzinfo=timezone.utc), total_with_vat=1250, vat_total=163.043))
    assert d[4] == "1250.00" and d[5] == "163.04"


def test_value_longer_than_255_bytes_is_rejected():
    with pytest.raises(ValueError):
        tlv(1, "ا" * 200)
