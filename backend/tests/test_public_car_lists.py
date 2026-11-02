# قوائم الماركات/الموديلات للعميل: نظيفة (لا «تويوتا كامري» كماركة)، والماركة أولاً ثم الموديل
from app.modules.cars.api import clean_public_brands as brands, clean_public_models as models
from app.modules.cars.service import CAR_CATALOG


def test_brands_exclude_composite_and_model_values():
    real = ["تويوتا كامري", "تويوتا", "كامري", "هيونداي النترا 2020", "نيسان", "بي واي دي", "تويوتا"]
    out = brands(real, CAR_CATALOG)
    assert "تويوتا كامري" not in out and "كامري" not in out and "هيونداي النترا 2020" not in out
    assert out.index("تويوتا") < out.index("نيسان")                    # ترتيب الواقع أولاً
    assert out.count("تويوتا") == 1 and "هيونداي" in out              # الباقي من الكتالوج
    assert "بي واي دي" in out                                         # ماركة نادرة حقيقية تبقى


def test_models_strip_brand_prefix_and_dedupe():
    out = models(["تويوتا كامري", "كامري", "كورولا", "تويوتا"], "تويوتا", ["كامري", "يارس"])
    assert out[:3] == ["كامري", "كورولا", "يارس"] and len(out) == len(set(out)) and "تويوتا" not in out
