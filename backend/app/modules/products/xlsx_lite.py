# -*- coding: utf-8 -*-
"""قارئ xlsx خفيف — مكتبات بايثون الأساسية فقط (zipfile + xml)، بدون openpyxl.
يكفي تماماً لملفات تصدير Odoo البسيطة (صف عناوين + بيانات، شيت واحد)."""
import re
import zipfile
from xml.etree import ElementTree as ET

_NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def _col_index(cell_ref: str) -> int:
    """A1 → 0, B2 → 1, AA5 → 26"""
    letters = re.match(r"[A-Z]+", cell_ref).group(0)
    idx = 0
    for ch in letters:
        idx = idx * 26 + (ord(ch) - 64)
    return idx - 1


def read_xlsx_rows(data: bytes) -> list[list[str]]:
    """يرجع كل صفوف أول شيت كنصوص — الأرقام بتتحول نص بدون أصفار عشرية زائدة
    (الباركود بيفضل سليم: 6291109551256 مش 6.29e12)"""
    with zipfile.ZipFile(__import__("io").BytesIO(data)) as z:
        # النصوص المشتركة
        shared: list[str] = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", _NS):
                shared.append("".join(t.text or "" for t in si.iter(
                    "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")))
        # أول شيت فعلي
        sheet_path = next((n for n in z.namelist()
                           if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)), None)
        if not sheet_path:
            raise ValueError("الملف لا يحتوي على أي شيت")
        root = ET.fromstring(z.read(sheet_path))
        rows: list[list[str]] = []
        for r in root.findall(".//m:sheetData/m:row", _NS):
            row: list[str] = []
            for c in r.findall("m:c", _NS):
                idx = _col_index(c.get("r", "A1"))
                while len(row) < idx:
                    row.append("")
                t = c.get("t")
                v_el = c.find("m:v", _NS)
                if t == "inlineStr":
                    is_el = c.find("m:is", _NS)
                    val = "".join(x.text or "" for x in is_el.iter(
                        "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")) if is_el is not None else ""
                elif v_el is None or v_el.text is None:
                    val = ""
                elif t == "s":
                    val = shared[int(v_el.text)]
                else:
                    raw = v_el.text
                    # رقم؟ نحوله نص نظيف: 12.0 → "12" والباركود الطويل بيفضل كامل
                    try:
                        f = float(raw)
                        val = str(int(f)) if f == int(f) else f"{f:.6f}".rstrip("0").rstrip(".")
                    except ValueError:
                        val = raw
                row.append(val.strip() if isinstance(val, str) else val)
            rows.append(row)
        return rows
