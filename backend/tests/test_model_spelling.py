# «كرولا» و«كورولا» موديل واحد: يظهر مرة واحدة بتهجئة الكتالوج في القوائم، ويتطابق في المقارنة
from app.modules.cars.api import _merge_with_catalog, clean_public_models
from app.modules.cars.service import CAR_CATALOG, _ar_normalize


def test_normalize_treats_spellings_as_one():
    assert _ar_normalize("كرولا") == _ar_normalize("كورولا") == _ar_normalize("  كورولا ")
    assert _ar_normalize("كامرى") == _ar_normalize("كامري")


def test_admin_merge_dedupes_and_prefers_catalog_spelling():
    out = _merge_with_catalog(["كرولا", "كامرى", "ريف 4"], CAR_CATALOG["تويوتا"])
    assert out.count("كورولا") == 1 and "كرولا" not in out         # لا تكرار، وبتهجئة الكتالوج
    assert "ريف 4" in out and "كامري" in out and "كامرى" not in out   # غير المعروف يبقى، والمعروف بتهجئة الكتالوج


def test_public_models_dedupe():
    out = clean_public_models(["كرولا", "تويوتا كرولا", "كورولا"], "تويوتا", CAR_CATALOG["تويوتا"])
    assert out.count("كورولا") == 1 and "كرولا" not in out
