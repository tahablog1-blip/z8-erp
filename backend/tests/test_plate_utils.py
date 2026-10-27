import pytest
from app.core.plate_utils import normalize_plate, plate_identity

SAME = ["AAA 111", "aaa 111", "111 AAA", "111aaa", "A-A-A 111", "١١١ ااا", "أأأ 111", "111 أ أ أ"]


@pytest.mark.parametrize("raw", SAME)
def test_same_plate_any_format_has_one_identity(raw):
    assert plate_identity(raw)[0] == plate_identity("AAA 111")[0] == "111-AAA"


def test_stored_display_is_canonical():
    assert plate_identity("aaa 111")[1] == "111 AAA"


def test_different_plates_differ():
    assert plate_identity("1111 AAA")[0] != plate_identity("111 AAA")[0]
    assert plate_identity("111 AAB")[0] != plate_identity("111 AAA")[0]


@pytest.mark.parametrize("raw,valid", [("111 AAA", True), ("1 BDR", True), ("1234 ABJ", True), ("ABC", False), ("111", False), ("", False), ("12 AB", False)])
def test_saudi_validity(raw, valid):
    assert plate_identity(raw)[2] is valid


def test_other_plate_type_ignores_spaces_and_case():
    assert plate_identity("ab-12", "other")[0] == plate_identity("AB 12", "other")[0]


def test_arabic_letters_map_to_traffic_letters():
    k = normalize_plate("أ ب ح 1234")
    assert (k.digits, k.letters_en) == ("1234", "ABJ")
