"""موديول الحسابات — شجرة الحسابات، سجل القيود، وثلاث تقارير مالية أساسية:
ميزان المراجعة، قائمة الدخل، الميزانية العمومية. كل الأرقام بتتحسب Live من
`journal_entries`/`journal_lines` اللي كل موديولات النظام (مخزون، فواتير،
مشتريات) بتكتب فيها — مفيش جدول أرصدة مخزّن منفصل يحتاج تسوية.

⚠ إنشاء/حذف حساب مخصص مقصور على دور admin بالحرف (require_role)، مش مجرد
صلاحية عادية — تعديل شجرة الحسابات أخطر من مجرد الاطلاع عليها.
"""
from .api import router

MODULE = {
    "name": "accounting",
    "label": "الحسابات",
    "router": router,
    "prefix": "/accounting",
    "nav": [
        {
            "path": "/accounting",
            "label": "الحسابات",
            "icon": "calculator",
            "perms": ["accounting.view_reports"],
        }
    ],
}
