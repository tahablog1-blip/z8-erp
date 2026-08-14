"""موديول الموردين — سجل الموردين (مركزي على مستوى الشركة، مش لكل فرع) +
كشف حساب الذمم الدائنة + سندات الصرف. نفس بنية موديول العملاء بالظبط بس
في الاتجاه المعاكس (نحن مدينون للمورد لا العكس).
"""
from .api import router

MODULE = {
    "name": "suppliers",
    "label": "الموردون",
    "router": router,
    "prefix": "/suppliers",
    "nav": [
        {
            "path": "/suppliers",
            "label": "الموردون",
            "icon": "truck",
            "perms": ["purchasing.suppliers"],
        }
    ],
}
