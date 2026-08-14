"""موديول المخزون — الأرصدة، الاستلام من الموردين، التحويلات، وسندات الحركة.

ليه موديول منفصل عن «الأصناف»؟ الأصناف كتالوج (تعريف الصنف وسعره)،
والمخزون دفتر كميات (رصيد كل صنف في كل موقع + سجل حركاته).
الفصل ده بيخلي كل موديول يحتفظ بمسار الـ API بتاعه زي النظام القديم بالحرف
(/api/products و /api/inventory) — أي واجهة قديمة تفضل شغالة من غير تعديل.

المواقع في النظام: 'warehouse' برصيد واحد ثابت loc_id='main'،
أو 'branch' وساعتها loc_id = معرّف الفرع كنص.
"""
from .api import router

MODULE = {
    "name": "inventory",
    "label": "المخزون",
    "router": router,
    "prefix": "/inventory",
    "nav": [
        {
            "path": "/inventory",
            "label": "المخزون",
            "icon": "warehouse",
            "perms": ["products.view_stock"],
        }
    ],
}
