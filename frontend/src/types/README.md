# الأنواع المولّدة تلقائياً من الباك اند

`api-generated.d.ts` بيتولّد من عقد OpenAPI بتاع FastAPI مباشرة — يعني أي حقل جديد
في الباك اند بيظهر هنا تلقائياً، وأي اختلاف بين الواجهة والخلفية بيمسكه فحص TypeScript
بدل ما يقع وقت التشغيل.

## التوليد
والنظام شغال (الباك اند على 4001): دبل كليك `gen-types.bat` في جذر المشروع،
أو من داخل frontend:

    npm run gen-types

## الاستخدام في الكود
```ts
import type { components } from "@/types/api-generated";
type CarOut = components["schemas"]["CarOut"];
```

اعمل توليد بعد أي تعديل في عقود الباك اند (schemas.py).
