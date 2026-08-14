"""موديول الفروع — **النموذج الذهبي** لكل موديول جديد في المنصة.

عايز تضيف موديول (CRM، عقود، أسطول...)؟ انسخ المجلد ده وبدّل:
  models.py  → موديل SQLAlchemy مطابق لجدولك
  schemas.py → أشكال الإدخال/الإخراج (Pydantic)
  service.py → منطق الأعمال (استعلامات، قواعد، تدقيق)
  api.py     → الـ endpoints بحراس الصلاحيات
  __init__   → المانيفست: النواة بتركّبه والقائمة الجانبية بتظهر لوحدها
"""
from .api import router

MODULE = {
    "name": "branches",
    "label": "الفروع",
    "router": router,
    "prefix": "/branches",
    "nav": [
        {
            "path": "/branches",
            "label": "الفروع",
            "icon": "store",
            # القائمة بتظهر لأي حد معاه أي صلاحية منهم — نفس منطق النظام القديم
            "perms": ["branches.manage"],
        }
    ],
}
