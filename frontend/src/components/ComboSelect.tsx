"use client";
// ComboSelect — قائمة منسدلة + خيار «أخرى...» يفتح كتابة حرة، ويتعرّف تلقائياً على القيم القديمة غير الموجودة بالقائمة.
import { MIcon } from "@/components/m-icon";
import { useEffect, useState } from "react";
import { Input, Select } from "@/components/ui";

export function ComboSelect({ value, options, placeholder, onChange }: {
  value: string; options: string[]; placeholder?: string; onChange: (v: string) => void;
}) {
  const inList = value === "" || options.includes(value);
  const [other, setOther] = useState(!inList);
  useEffect(() => { setOther(!(value === "" || options.includes(value))); }, []); // eslint-disable-line
  if (other) {
    return (
      <div className="flex gap-1.5">
        <Input value={value} placeholder={placeholder || "اكتب..."} autoFocus
               onChange={(e) => onChange(e.target.value)} />
        <button type="button" onClick={() => { setOther(false); onChange(""); }}
                className="z8-anim-btn shrink-0 rounded-lg border border-line px-2 text-t-xs font-bold text-text-dim hover:text-text"
                title="الرجوع للقائمة" aria-label="الرجوع للقائمة"><MIcon name="list" className="!text-[16px]" /></button>
      </div>
    );
  }
  return (
    <Select value={value}
            onChange={(e) => {
              if (e.target.value === "__other__") { setOther(true); onChange(""); }
              else onChange(e.target.value);
            }}>
      <option value="">— اختر —</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
      <option value="__other__">أخرى...</option>
    </Select>
  );
}

