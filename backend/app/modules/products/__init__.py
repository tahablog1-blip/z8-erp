"""موديول الأصناف — كتالوج المنتجات (زيوت، فلاتر، سوائل...).

مبني على نفس نمط «الفروع» بالحرف:
  schemas.py → عقود الإدخال/الإخراج (camelCase زي النظام القديم)
  service.py → منطق الأعمال والاستعلامات (منقولة من products.routes.js)
  api.py     → الـ endpoints بحراس الصلاحيات
  module.py  → المانيفست اللي المحمّل الآلي بيقراه

⚠ price_vat مش بيتحسب هنا — في القاعدة تريجر (trg_products_price_vat)
   بيحسبه تلقائياً من price ونسبة ضريبة الشركة عند أي INSERT/UPDATE للسعر.
"""
from .api import router

MODULE = {
    "name": "products",
    "label": "الأصناف",
    "router": router,
    "prefix": "/products",
    "nav": [
        {
            "path": "/products",
            "label": "الأصناف",
            "icon": "package",
            "perms": ["products.create", "products.edit", "products.view_stock"],
        }
    ],
}
