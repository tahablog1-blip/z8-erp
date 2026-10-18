"use client";
// ═══════════════════════════════════════════════════════════════════════
// بانوراما ثلاثية الأبعاد حقيقية (WebGL / three.js) لمحطتَي "الانتظار" و"الخدمة"
// — سيارة حقيقية (نموذج GLTF مُحمَّل فعليًا، برخصة CC-BY-4.0 — راجع
//   public/models/CREDITS.md)، وسير خدمة/عمّال مُبنيان إجرائيًا بأشكال
//   هندسية بسيطة، مع محرك حركة خاص خفيف يتبع حالة البيانات الحقيقية:
//   دخول سيارة للانتظار → تدخل وتنتظر في مكانها، انتقالها للخدمة → تتحرك إلى
//   سير الخدمة (يتّسع لـ 4 سيارات معًا) ويعمل العمّال عليها، وعند الخروج
//   تنزل عن السير وتخرج السيارة.
// — يحترم الوضع الليلي/النهاري، وتفضيل "تقليل الحركة"، ويوقف العرض عند
//   اختفاء العنصر من الشاشة أو تبديل التبويب (حفاظًا على الأداء).
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type BayCar = { id: string; plate?: string };

// نموذج السيارة الحقيقي (public/models/car.glb) — يُحمَّل مرة واحدة ثم
// يُستنسخ لكل سيارة؛ الطول المستهدف بعد القياس يطابق طول الصندوق الإجرائي
// القديم (1.9) حتى تبقى كل مسافات المشهد (مواقف/سير/كاميرا) صحيحة بدون لمسها.
const CAR_MODEL_URL = "/models/car.glb";
const CAR_LENGTH_TARGET = 1.9;
const CAR_BODY_MATERIAL_NAME = "Kiri10_bodymat";

const PARK_SLOTS = 4;
const PARK_X = 4.8;
const EXIT_X = 11;
const SLOT_Z = [-2.4, -0.8, 0.8, 2.4];

// سير الخدمة: منصة واحدة طويلة تتّسع لـ 4 سيارات معًا (بدل رافعات منفصلة).
const LINE_SLOTS = 4;
const LINE_X = -5.6;
const LINE_SLOT_Z = [-3.0, -1.0, 1.0, 3.0];
const LINE_SLOT_POS: [number, number][] = LINE_SLOT_Z.map((z) => [LINE_X, z]);
const LINE_HALF_LEN = 4.3;
const LINE_HEIGHT = 0.3;

type CarState = "entering" | "parked" | "toLift" | "lifting" | "working" | "lowering" | "leaving";

type TrackedCar = {
  id: string;
  plate: string;
  group: THREE.Group;
  label: THREE.Sprite;
  labelMat: THREE.SpriteMaterial;
  labelTex: THREE.CanvasTexture;
  state: CarState;
  slot: number; // parking slot index, -1 if none
  bay: number; // current index within lineOrder (recomputed live each frame), -1 if none
  x: number; z: number; // logical ground position (ramp height applied separately)
  liftP: number; // 0..1 ramp-mount progress
  bob: number; // idle bob phase
  doneWaiting: boolean; // الخدمة انتهت فعليًا لكنها لم تصل بعد لمقدمة السير
};

function hashColor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const palette = [0x2e6bd6, 0x16a34a, 0xdc8a1d, 0x7c3aed, 0x0f9ba0, 0xb91c1c, 0x475569, 0xc2410c];
  return palette[h % palette.length];
}

function buildCar(color: number): THREE.Group {
  const g = new THREE.Group();
  // طلاء سيارة حقيقي: طبقة clearcoat لامعة فوق اللون الأساسي بدل سطح مطفي مسطّح
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color, roughness: 0.32, metalness: 0.2, clearcoat: 0.75, clearcoatRoughness: 0.12,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x151c26, roughness: 0.1, metalness: 0.3, clearcoat: 0.4, envMapIntensity: 1.2,
  });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.85 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xb9bfc9, roughness: 0.3, metalness: 0.85 });
  const mirrorMat = bodyMat;

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.42, 0.95), bodyMat);
  body.position.y = 0.36;
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);

  // سقف منحدر بطابقين بدل صندوق واحد — يكسر الشكل الكتلي ويقرّب السيارة من الواقعية
  const roof = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.18, 0.78), bodyMat);
  roof.position.set(-0.14, 0.9, 0);
  roof.castShadow = true;
  g.add(roof);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.3, 0.84), glassMat);
  cabin.position.set(-0.12, 0.72, 0);
  cabin.castShadow = true;
  g.add(cabin);

  // زجاج أمامي/خلفي مائل — يعطي خط سقف انسيابيًا بدل الصندوق المستقيم
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.05, 0.78), glassMat);
  windshield.position.set(0.42, 0.68, 0);
  windshield.rotation.z = -0.62;
  g.add(windshield);
  const rearWindow = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.78), glassMat);
  rearWindow.position.set(-0.56, 0.68, 0);
  rearWindow.rotation.z = 0.55;
  g.add(rearWindow);

  const bumperMat = new THREE.MeshStandardMaterial({ color: 0x20242b, roughness: 0.7 });
  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 1.0), bumperMat);
  bumperF.position.set(0.98, 0.22, 0);
  g.add(bumperF);
  const bumperR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 1.0), bumperMat);
  bumperR.position.set(-0.98, 0.22, 0);
  g.add(bumperR);

  const wheelGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.2, 18);
  const rimGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.205, 18);
  const wheelPositions: [number, number][] = [[0.68, 0.47], [0.68, -0.47], [-0.68, 0.47], [-0.68, -0.47]];
  for (const [wx, wz] of wheelPositions) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(wx, 0.22, wz);
    wheel.castShadow = true;
    g.add(wheel);
    // قرص جنط فاتح بلون معدني — يكسر كتلة الإطار الأسود الصرفة
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(wx, 0.22, wz);
    g.add(rim);
  }

  const lightMat = new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0x4a3a00, emissiveIntensity: 0.4 });
  const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.65), lightMat);
  headlight.position.set(0.96, 0.4, 0);
  g.add(headlight);

  // مرايا جانبية — تفصيلة صغيرة لكنها من أوضح الفروق بين "صندوق" و"سيارة"
  for (const side of [-1, 1]) {
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.16), mirrorMat);
    mirror.position.set(0.42, 0.68, side * 0.52);
    mirror.castShadow = true;
    g.add(mirror);
  }

  return g;
}

function buildWorker(): THREE.Group {
  const g = new THREE.Group();
  const overallMat = new THREE.MeshStandardMaterial({ color: 0x2b4a6b, roughness: 0.85 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xd8a878, roughness: 0.8 });

  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.62, 0.26), overallMat);
  legs.position.y = 0.31;
  legs.castShadow = true;
  g.add(legs);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.28), overallMat);
  torso.position.y = 0.87;
  torso.castShadow = true;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), skinMat);
  head.position.y = 1.2;
  head.castShadow = true;
  g.add(head);

  const armGeo = new THREE.BoxGeometry(0.13, 0.46, 0.13);
  const armL = new THREE.Mesh(armGeo, skinMat);
  armL.geometry.translate(0, -0.23, 0);
  armL.position.set(-0.27, 1.07, 0);
  g.add(armL);

  const armR = new THREE.Mesh(armGeo, skinMat);
  armR.geometry.translate(0, -0.23, 0);
  armR.position.set(0.27, 1.07, 0);
  g.add(armR);
  (g as any)._workArm = armR;

  return g;
}

function buildServiceLine(centerX: number, halfLen: number, height: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(centerX, 0, 0);

  const platMat = new THREE.MeshStandardMaterial({ color: 0x5b6472, roughness: 0.5, metalness: 0.4 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x2f3645, roughness: 0.45, metalness: 0.55 });
  const rollerMat = new THREE.MeshStandardMaterial({ color: 0xf2b800, roughness: 0.55 });

  const platform = new THREE.Mesh(new THREE.BoxGeometry(2.2, height, halfLen * 2), platMat);
  platform.position.y = height / 2;
  platform.castShadow = true;
  platform.receiveShadow = true;
  g.add(platform);

  // قضيبا جانبَي السير — يبرزان المنصة كـ"خط" متصل بدل كتلة عادية
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, halfLen * 2 + 0.2), railMat);
    rail.position.set(side * 1.13, height + 0.06, 0);
    rail.castShadow = true;
    g.add(rail);
  }

  // شرائح صفراء متكررة على سطح السير — توحي بحزام/بكرات ناقلة (سير حقيقي)
  const rollerCount = 18;
  for (let i = 0; i < rollerCount; i++) {
    const z = -halfLen + (i + 0.5) * ((halfLen * 2) / rollerCount);
    const roller = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.03, 0.1), rollerMat);
    roller.position.set(0, height + 0.016, z);
    g.add(roller);
  }

  // منحدرا الدخول والخروج عند طرفَي السير — تقريب مبسّط (مشهد تصميمي مجسّم)
  for (const side of [-1, 1]) {
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 1.2), platMat);
    ramp.position.set(0, height / 2 - 0.03, side * (halfLen + 0.5));
    ramp.rotation.x = -side * 0.22;
    ramp.castShadow = true;
    ramp.receiveShadow = true;
    g.add(ramp);
  }

  // علامات تحذيرية صفراء/سوداء عند مدخل السير
  for (let i = -1; i <= 1; i += 2) {
    const marker = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.01, 0.12), rollerMat);
    marker.position.set(0, height + 0.006, i * (halfLen + 0.95));
    g.add(marker);
  }

  return g;
}

function makeLabelSprite(text: string, dark: boolean): { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; tex: THREE.CanvasTexture } {
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 72;
  const ctx = canvas.getContext("2d")!;
  drawLabel(ctx, canvas, text, dark);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.5, 0.42, 1);
  return { sprite, mat, tex };
}

// نسيج تشويش بسيط (grayscale) يُستخدم كخريطة خشونة/انبعاج للأرضية — يكسر
// الملمس المسطّح "الكرتوني" للمستوى الواحد اللون بدون تعقيد مكلف.
function makeNoiseTexture(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 150 + Math.floor((Math.random() - 0.5) * 70);
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 5);
  return tex;
}

// تدرّج سماء بسيط (أفتح أعلى → أغمق عند الأفق) بدل لون خلفية مسطّح واحد —
// يعطي إحساسًا بعمق المشهد بدل الطفو في فراغ.
function makeSkyTexture(top: string, bottom: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 8; canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function drawLabel(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, text: string, dark: boolean) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = dark ? "rgba(17,28,46,0.92)" : "rgba(255,255,255,0.94)";
  const r = 16;
  ctx.beginPath();
  ctx.moveTo(r, 4); ctx.arcTo(canvas.width - 4, 4, canvas.width - 4, canvas.height - 4, r);
  ctx.arcTo(canvas.width - 4, canvas.height - 4, 4, canvas.height - 4, r);
  ctx.arcTo(4, canvas.height - 4, 4, 4, r); ctx.arcTo(4, 4, canvas.width - 4, 4, r);
  ctx.closePath();
  ctx.fill();
  ctx.font = "700 34px Arial, sans-serif";
  ctx.fillStyle = dark ? "#EDF2FA" : "#0F172A";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
}

export default function ServiceBay3D({ queued, inService }: { queued: BayCar[]; inService: BayCar[] }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mountEl = mountRef.current;
    if (!mountEl) return;
    const mount: HTMLDivElement = mountEl;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    let dark = document.documentElement.dataset.theme === "dark";
    let disposed = false;

    const scene = new THREE.Scene();
    // كاميرا أقل حدة وأبعد قليلًا — إطار مريح يحتضن منطقتَي الانتظار
    // والرافعات معًا دون تراكب أو اقتصاص عند حوافّ اللوحة.
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(-0.4, 5.6, 13.2);
    camera.lookAt(-0.9, 0.35, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    // إضاءة بيئية (IBL) من غرفة اصطناعية مولَّدة — هي ما يمنح الطلاء والمعدن
    // انعكاسات حقيقية بدل السطح المطفي المسطّح الذي يبدو "كرتونيًا".
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.045).texture;
    scene.environment = envTex;
    pmrem.dispose();

    // تحميل نموذج السيارة الحقيقي مرة واحدة فقط (غير مُضاف للمشهد مباشرة —
    // مجرد قالب تُستنسخ منه كل سيارة). إلى أن يكتمل التحميل، تُستخدم السيارة
    // الإجرائية (buildCar) كبديل فوري حتى لا تبقى اللوحة فارغة أثناء الانتظار.
    let carTemplate: THREE.Group | null = null;
    let carTemplateScale = 1;
    const gltfLoader = new GLTFLoader();
    gltfLoader.load(
      CAR_MODEL_URL,
      (gltf) => {
        if (disposed) {
          gltf.scene.traverse((o: any) => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => m.dispose?.());
          });
          return;
        }
        const root = gltf.scene;
        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        box.getSize(size);
        carTemplateScale = CAR_LENGTH_TARGET / (size.x || 1);
        root.traverse((o: any) => {
          if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
        });
        carTemplate = root;
      },
      undefined,
      () => { /* فشل التحميل — تبقى السيارات الإجرائية كبديل دائم بصمت */ },
    );

    function buildRealCar(color: number): THREE.Group | null {
      if (!carTemplate) return null;
      const clone = carTemplate.clone(true);
      clone.scale.setScalar(carTemplateScale);
      // كل سيارة تأخذ نسخة خاصة بها من مادة الهيكل لتلوينها دون المساس
      // بالمادة المشتركة التي يعتمد عليها القالب والنسخ الأخرى.
      clone.traverse((o: any) => {
        if (o.isMesh && o.material && o.material.name === CAR_BODY_MATERIAL_NAME) {
          const m = o.material.clone();
          m.color.setHex(color);
          o.material = m;
          o.userData.ownMaterial = m;
        }
      });
      clone.userData.isGltfCar = true;
      return clone;
    }

    const hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 0.7);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(6, 9, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -11; sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 6; sun.shadow.camera.bottom = -6;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 25;
    sun.shadow.bias = -0.0015;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.3);
    fill.position.set(-5, 4, -3);
    scene.add(fill);

    const groundNoise = makeNoiseTexture();
    const groundMat = new THREE.MeshStandardMaterial({ roughness: 0.95, roughnessMap: groundNoise, bumpMap: groundNoise, bumpScale: 0.012 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 13), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // بلاطة خرسانية أفتح تحت سير الخدمة — تميّزه بصريًا عن أرضية الانتظار
    const padMat = new THREE.MeshStandardMaterial({ roughness: 0.9, roughnessMap: groundNoise, bumpMap: groundNoise, bumpScale: 0.008 });
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(3.0, LINE_HALF_LEN * 2 + 2.6), padMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(LINE_X, 0.006, 0);
    pad.receiveShadow = true;
    scene.add(pad);

    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
    const slotLines = new THREE.Group();
    for (const sz of SLOT_Z) {
      const pts = [
        new THREE.Vector3(PARK_X - 0.98, 0.012, sz - 0.62),
        new THREE.Vector3(PARK_X + 0.98, 0.012, sz - 0.62),
        new THREE.Vector3(PARK_X + 0.98, 0.012, sz + 0.62),
        new THREE.Vector3(PARK_X - 0.98, 0.012, sz + 0.62),
        new THREE.Vector3(PARK_X - 0.98, 0.012, sz - 0.62),
      ];
      slotLines.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
    }
    scene.add(slotLines);

    const serviceLine = buildServiceLine(LINE_X, LINE_HALF_LEN, LINE_HEIGHT);
    scene.add(serviceLine);

    // عاملان على طول السير — كل عامل يغطي نصف المواقع الأربعة
    const workers: THREE.Group[] = [];
    const workerZ = [LINE_SLOT_Z[0] + 1.0, LINE_SLOT_Z[2] + 1.0];
    for (const wz of workerZ) {
      const worker = buildWorker();
      worker.position.set(LINE_X + 1.55, 0, wz);
      worker.rotation.y = 2.5;
      scene.add(worker);
      workers.push(worker);
    }

    let skyTex: THREE.CanvasTexture | null = null;
    function applyTheme(isDark: boolean) {
      dark = isDark;
      groundMat.color.set(isDark ? 0x16233a : 0xdfe7f2);
      padMat.color.set(isDark ? 0x2a3a56 : 0xcdd7e6);
      scene.fog = new THREE.Fog(isDark ? 0x0b1220 : 0xeaf1fb, 10, 24);
      const prevSky = skyTex;
      skyTex = makeSkyTexture(isDark ? "#16233f" : "#eef4fc", isDark ? "#0a1120" : "#cfdcee");
      scene.background = skyTex;
      renderer.setClearColor(isDark ? 0x0b1220 : 0xeaf1fb, 1);
      prevSky?.dispose();
    }
    applyTheme(dark);

    const tracked = new Map<string, TrackedCar>();
    // ترتيب السيارات الفعلي على السير: المؤشر 0 = أقرب سيارة للخروج (مقدمة
    // السير). عند خروج المقدمة يُحذف العنصر الأول فتتزحزح البقية تلقائيًا
    // لأن موضع كل سيارة يُحسب من مكانها الحالي داخل هذه المصفوفة كل إطار.
    const lineOrder: string[] = [];
    const freeParkSlot = () => {
      const used = new Set<number>();
      tracked.forEach((c) => { if (c.slot >= 0 && c.state !== "leaving") used.add(c.slot); });
      for (let i = 0; i < PARK_SLOTS; i++) if (!used.has(i)) return i;
      return -1;
    };

    function spawnCar(id: string, plate: string, directToLift: boolean): TrackedCar {
      const group = buildRealCar(hashColor(id)) ?? buildCar(hashColor(id));
      const { sprite, mat, tex } = makeLabelSprite(plate || "—", dark);
      sprite.position.set(0, 1.15, 0);
      group.add(sprite);
      scene.add(group);
      const slot = directToLift ? -1 : freeParkSlot();
      const startX = directToLift ? -EXIT_X : EXIT_X;
      const startZ = directToLift ? LINE_SLOT_POS[0][1] : (slot >= 0 ? SLOT_Z[slot] : 0);
      group.position.set(startX, 0, startZ);
      group.rotation.y = directToLift ? Math.PI : Math.PI;
      const tc: TrackedCar = {
        id, plate, group, label: sprite, labelMat: mat, labelTex: tex,
        state: "entering", slot, bay: -1, x: startX, z: startZ, liftP: 0,
        bob: Math.random() * Math.PI * 2, doneWaiting: false,
      };
      tracked.set(id, tc);
      return tc;
    }

    function syncFromProps(q: BayCar[], svc: BayCar[]) {
      const qIds = new Set(q.map((c) => c.id));
      const sIds = new Set(svc.map((c) => c.id));

      q.forEach((c) => { if (!tracked.has(c.id)) spawnCar(c.id, c.plate || "", false); });
      svc.forEach((c) => {
        if (!tracked.has(c.id)) { spawnCar(c.id, c.plate || "", true); return; }
        const tc = tracked.get(c.id)!;
        tc.doneWaiting = false; // ما زالت قيد الخدمة فعليًا حسب البيانات
        if ((tc.state === "entering" || tc.state === "parked") && lineOrder.length < LINE_SLOTS && !lineOrder.includes(c.id)) {
          lineOrder.push(c.id); // تدخل من مؤخرة السير (جهة الانتظار)
          tc.slot = -1;
          tc.state = "toLift";
        }
      });
      tracked.forEach((tc, id) => {
        if (!qIds.has(id) && !sIds.has(id) && tc.state !== "leaving" && tc.state !== "lowering") {
          if (lineOrder.includes(id)) {
            // انتهت خدمتها فعليًا لكنها تنتظر دورها في مقدمة السير لتخرج
            tc.doneWaiting = true;
          } else {
            tc.state = tc.liftP > 0.02 ? "lowering" : "leaving";
          }
        }
      });
    }

    syncFromProps(queued, inService);
    const prevKey = { current: JSON.stringify([...queued.map((c) => c.id), ...inService.map((c) => c.id)]) };

    let raf = 0;
    let last = performance.now();
    let paused = false;

    function tick(now: number) {
      raf = requestAnimationFrame(tick);
      if (paused) { last = now; return; }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const speed = 3.1;

      // تحقّق: هل السيارة في مقدمة السير جاهزة فعلًا للخروج؟ إن كانت كذلك
      // تُحذف من lineOrder فورًا فتتزحزح كل السيارات خلفها تلقائيًا (لأن
      // موضع كل سيارة يُحسب أدناه من فهرسها الحالي داخل lineOrder).
      if (lineOrder.length) {
        const front = tracked.get(lineOrder[0]);
        if (front && front.doneWaiting && (front.state === "working" || front.state === "lifting")) {
          lineOrder.shift();
          front.state = "lowering";
        }
      }

      tracked.forEach((tc, id) => {
        const g = tc.group;
        if (tc.state === "entering") {
          const slotZ = tc.slot >= 0 ? SLOT_Z[tc.slot] : 0;
          const targetX = PARK_X;
          tc.x += Math.sign(targetX - tc.x) * Math.min(Math.abs(targetX - tc.x), speed * dt);
          tc.z += Math.sign(slotZ - tc.z) * Math.min(Math.abs(slotZ - tc.z) * 0.6, speed * dt * 0.8);
          if (Math.abs(tc.x - targetX) < 0.04) { tc.x = targetX; tc.state = "parked"; }
        } else if (tc.state === "parked") {
          tc.bob += dt * 1.4;
        } else if (tc.state === "toLift" || tc.state === "lifting" || tc.state === "working") {
          // أثناء وجودها على السير، موضعها الأفقي يُشتق حيًا من فهرسها داخل
          // lineOrder — هذا وحده ما يُنتج حركة "تقدّم السير" عند تزحزح الفهرس.
          const idx = lineOrder.indexOf(id);
          tc.bay = idx;
          const bz = idx >= 0 ? LINE_SLOT_Z[idx] : tc.z;
          tc.x += Math.sign(LINE_X - tc.x) * Math.min(Math.abs(LINE_X - tc.x), speed * dt);
          tc.z += Math.sign(bz - tc.z) * Math.min(Math.abs(bz - tc.z), speed * dt);
          if (tc.state === "toLift" && Math.abs(tc.x - LINE_X) < 0.04 && Math.abs(tc.z - bz) < 0.04) {
            tc.state = "lifting";
          }
          if (tc.state === "lifting") {
            // صعود قصير على منصة السير (ليس رافعة هيدروليكية) — أسرع بكثير
            tc.liftP = Math.min(1, tc.liftP + dt / (reduceMotion ? 0.05 : 0.45));
            if (tc.liftP >= 1) tc.state = "working";
          }
        } else if (tc.state === "lowering") {
          tc.liftP = Math.max(0, tc.liftP - dt / (reduceMotion ? 0.05 : 0.35));
          if (tc.liftP <= 0) tc.state = "leaving";
        } else if (tc.state === "leaving") {
          const exitX = tc.bay >= 0 ? -EXIT_X : EXIT_X + 2;
          tc.x += Math.sign(exitX - tc.x) * speed * 1.4 * dt;
          if (Math.abs(tc.x - exitX) < 0.3) {
            scene.remove(g);
            if (g.userData.isGltfCar) {
              // الهندسة والمواد الأصلية مشتركة مع القالب ونسخ أخرى — لا تُحذف
              // هنا، فقط نسخة مادة الهيكل الخاصة بهذه السيارة تحديدًا.
              g.traverse((o: any) => { o.userData?.ownMaterial?.dispose?.(); });
            } else {
              g.traverse((o: any) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => m.dispose?.()); });
            }
            tc.labelTex.dispose(); tc.labelMat.dispose();
            tracked.delete(id);
            return;
          }
        }

        const bobY = (tc.state === "parked" && !reduceMotion) ? Math.sin(tc.bob) * 0.025 : 0;
        g.position.set(tc.x, bobY + tc.liftP * LINE_HEIGHT, tc.z);
        const desiredYaw = tc.state === "entering" || tc.state === "toLift" || tc.state === "leaving" ? Math.PI : Math.PI;
        g.rotation.y += (desiredYaw - g.rotation.y) * Math.min(1, dt * 4);
      });

      if (!reduceMotion) {
        const cars = Array.from(tracked.values());
        const anyWorking = cars.some((c) => (c.bay === 0 || c.bay === 1) && (c.state === "working" || c.state === "lifting"));
        const anyWorking2 = cars.some((c) => (c.bay === 2 || c.bay === 3) && (c.state === "working" || c.state === "lifting"));
        [anyWorking, anyWorking2].forEach((active, i) => {
          const arm = (workers[i] as any)?._workArm as THREE.Mesh | undefined;
          if (!arm) return;
          arm.rotation.x = active ? Math.sin(now / 160) * 0.6 - 0.3 : -0.1;
        });
      }

      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(tick);

    function resize() {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const onVis = () => { paused = document.hidden; };
    document.addEventListener("visibilitychange", onVis);

    const io = new IntersectionObserver((entries) => {
      paused = paused || false;
      entries.forEach((e) => { paused = !e.isIntersecting || document.hidden; });
    }, { threshold: 0.05 });
    io.observe(mount);

    const themeObserver = new MutationObserver(() => {
      applyTheme(document.documentElement.dataset.theme === "dark");
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    (mount as any)._z8SyncProps = syncFromProps;

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      tracked.forEach((tc) => { tc.labelTex.dispose(); tc.labelMat.dispose(); });
      scene.traverse((o: any) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => m.dispose?.());
      });
      // قالب السيارة المحمَّل غير مُضاف للمشهد، فلن يزوره scene.traverse أعلاه
      carTemplate?.traverse((o: any) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => m.dispose?.());
      });
      envTex.dispose();
      groundNoise.dispose();
      skyTex?.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
    // يُبنى المشهد مرة واحدة فقط؛ تحديثات البيانات تمر عبر الأثر التالي.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // دفع تحديثات البيانات الحية إلى المشهد القائم دون إعادة بنائه
  useEffect(() => {
    const mount = mountRef.current as any;
    mount?._z8SyncProps?.(queued, inService);
  }, [queued, inService]);

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-ink-2 shadow-sm">
      <div className="flex items-center justify-between border-b border-line px-5 py-2.5">
        <h2 className="text-[12.5px] font-extrabold text-text-dim">محطة الخدمة — عرض ثلاثي الأبعاد مباشر</h2>
        <div className="flex items-center gap-3 text-[11px] font-bold text-text-dim">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-brass" /> انتظار</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-petrol" /> سير الخدمة (4 سيارات)</span>
        </div>
      </div>
      <div ref={mountRef} className="h-[230px] w-full sm:h-[260px]" />
    </div>
  );
}
