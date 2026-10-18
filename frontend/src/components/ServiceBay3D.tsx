"use client";
// ═══════════════════════════════════════════════════════════════════════
// بانوراما ثلاثية الأبعاد حقيقية (WebGL / three.js) لمحطتَي "الانتظار" و"الخدمة"
// — سيارة وعامل حقيقيان (نموذجا GLTF مُحمَّلان فعليًا، مرخَّصان CC-BY-4.0 —
//   راجع public/models/CREDITS.md)، وسير الخدمة نفسه مبني إجرائيًا بأشكال
//   هندسية بسيطة، مع محرك حركة خاص خفيف يتبع حالة البيانات الحقيقية:
//   دخول سيارة للانتظار → تدخل وتنتظر في مكانها، انتقالها للخدمة → تتحرك إلى
//   سير الخدمة (يتّسع لـ 4 سيارات معًا)، وعند وصولها فعليًا لحالة العمل
//   يفتح كبودها ويَنحني العامل الثابت عند موقعها ليعمل فوق المحرك (فحص/تعبئة
//   ماء الرديتر والمساحات)، وعند الخروج يُغلق الكبود وتنزل عن السير وتخرج.
// — يحترم الوضع الليلي/النهاري، وتفضيل "تقليل الحركة"، ويوقف العرض عند
//   اختفاء العنصر من الشاشة أو تبديل التبويب (حفاظًا على الأداء).
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";

export type BayCar = { id: string; plate?: string };

// نموذج السيارة الحقيقي (public/models/car.glb) — يُحمَّل مرة واحدة ثم
// يُستنسخ لكل سيارة؛ الطول المستهدف بعد القياس يطابق طول الصندوق الإجرائي
// القديم (1.9) حتى تبقى كل مسافات المشهد (مواقف/سير/كاميرا) صحيحة بدون لمسها.
const CAR_MODEL_URL = "/models/car.glb";
const CAR_LENGTH_TARGET = 1.9;
const CAR_BODY_MATERIAL_NAME = "Kiri10_bodymat";

// الكبود عقدة منفصلة داخل نموذج السيارة (Kiri10_Hood) — تُعاد هيكلته مرة
// واحدة عند تحميل القالب حول محور دوران عند حافته الخلفية العلوية (قرب
// الزجاج الأمامي)، فيرثه كل استنساخ لاحق تلقائيًا (clone(true) يستنسخ
// التسلسل الهرمي كاملًا بما فيه هذه العقدة الفارغة الجديدة).
const HOOD_NODE_NAME = "Kiri10_Hood";
const HOOD_PIVOT_NAME = "Z8_HoodPivot";
const HOOD_OPEN_DEG = 70;

// نموذج العامل الحقيقي (public/models/worker.glb) — مُرخَّص CC-BY-4.0
// (راجع public/models/CREDITS.md). عامل واحد ثابت عند كل موقع من مواقع
// السير الأربعة، يُستنسخ بهيكل عظمي مستقل (SkeletonUtils.clone) حتى تملك
// كل نسخة حركتها الخاصة. الانحناء للأمام أثناء العمل يُضاف إجرائيًا فوق
// حركة "الوقوف" الأصلية بتدوير عظمة العمود الفقري Spine_02.
const WORKER_MODEL_URL = "/models/worker.glb";
const WORKER_HEIGHT_TARGET = 0.78;
const WORKER_SPINE_BONE_NAME = "Spine_02";
const WORKER_BEND_DEG = 34;

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
  hoodPivot: THREE.Object3D | null; // عقدة دوران الكبود (نماذج GLTF فقط)
  hoodP: number; // 0..1 تقدّم فتح الكبود
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

// ─── معدات الورشة (كلها إجرائية — ديكور ثابت يكسر فراغ الأرضية ويعطي
// إحساس "ورشة حقيقية" بدل خط خدمة معزول في فضاء فارغ) ───────────────────

function buildToolChest(): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xc81e2b, roughness: 0.35, metalness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.25 });
  const topMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.6 });
  const handleMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.4, metalness: 0.8 });

  const lower = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.52, 0.42), bodyMat);
  lower.position.y = 0.26;
  lower.castShadow = true; lower.receiveShadow = true;
  g.add(lower);

  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.34, 0.38), bodyMat);
  upper.position.y = 0.52 + 0.17;
  upper.castShadow = true;
  g.add(upper);

  const top = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.03, 0.4), topMat);
  top.position.y = 0.52 + 0.34 + 0.015;
  g.add(top);

  // شرائح الأدراج وأيديها — تفاصيل صغيرة تكسر كتلة الصندوق الأحمر الصرفة
  const drawerYs = [0.1, 0.26, 0.42];
  for (const dy of drawerYs) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.73, 0.012, 0.421), topMat);
    seam.position.y = dy;
    g.add(seam);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.025, 0.03), handleMat);
    handle.position.set(0, dy, 0.225);
    g.add(handle);
  }
  const upperHandle = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.025, 0.03), handleMat);
  upperHandle.position.set(0, 0.52 + 0.17, 0.205);
  g.add(upperHandle);

  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1d, roughness: 0.9 });
  const wheelGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10);
  for (const wx of [-0.3, 0.3]) for (const wz of [-0.16, 0.16]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.05, wz);
    g.add(wheel);
  }

  return g;
}

function buildTireStack(count = 4): THREE.Group {
  const g = new THREE.Group();
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.95 });
  const r = 0.32, tube = 0.12;
  for (let i = 0; i < count; i++) {
    const tire = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 10, 24), tireMat);
    tire.rotation.x = Math.PI / 2;
    tire.position.y = tube + i * tube * 1.55;
    tire.castShadow = true; tire.receiveShadow = true;
    g.add(tire);
  }
  return g;
}

function buildOilDrum(color: number): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.55 });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x20242b, roughness: 0.5, metalness: 0.5 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.82, 20), bodyMat);
  body.position.y = 0.41;
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);

  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.285, 0.285, 0.035, 20), bandMat);
  lid.position.y = 0.82 + 0.017;
  g.add(lid);

  for (const by of [0.2, 0.62]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.275, 0.275, 0.05, 20), bandMat);
    band.position.y = by;
    g.add(band);
  }

  return g;
}

function buildTrafficCone(): THREE.Group {
  const g = new THREE.Group();
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xe8600f, roughness: 0.6 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.5 });

  const base = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.26), coneMat);
  base.position.y = 0.015;
  base.castShadow = true;
  g.add(base);

  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.4, 14), coneMat);
  cone.position.y = 0.03 + 0.2;
  cone.castShadow = true;
  g.add(cone);

  const stripe = new THREE.Mesh(new THREE.ConeGeometry(0.095, 0.08, 14, 1, true), stripeMat);
  stripe.position.y = 0.03 + 0.26;
  g.add(stripe);

  return g;
}

function buildHangingLight(): THREE.Group {
  const g = new THREE.Group();
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.6, metalness: 0.5 });
  const shadeMat = new THREE.MeshStandardMaterial({ color: 0x33373f, roughness: 0.4, metalness: 0.6 });
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff3d2, emissive: 0xffdf9e, emissiveIntensity: 1.4 });

  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.9, 6), cableMat);
  cable.position.y = 0.45;
  g.add(cable);

  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.14, 16, 1, true), shadeMat);
  shade.rotation.x = Math.PI;
  shade.position.y = -0.03;
  shade.castShadow = true;
  g.add(shade);

  const bulb = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 16), bulbMat);
  bulb.position.y = -0.1;
  g.add(bulb);

  const glow = new THREE.PointLight(0xffdf9e, 0.6, 3.2, 2);
  glow.position.y = -0.12;
  glow.castShadow = false;
  g.add(glow);

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
        // أعد هيكلة عقدة الكبود مرة واحدة فقط هنا (على القالب نفسه) حول محور
        // دوران عند حافتها الخلفية العلوية، حتى يرثه كل استنساخ لاحق تلقائيًا.
        let hoodNode: THREE.Object3D | null = null;
        root.traverse((o: any) => { if (o.name === HOOD_NODE_NAME) hoodNode = o; });
        if (hoodNode && (hoodNode as THREE.Object3D).parent) {
          const hn = hoodNode as THREE.Object3D;
          const hbox = new THREE.Box3().setFromObject(hn);
          const hinge = new THREE.Vector3(hbox.min.x, hbox.max.y, (hbox.min.z + hbox.max.z) / 2);
          const parent = hn.parent!;
          const pivot = new THREE.Group();
          pivot.name = HOOD_PIVOT_NAME;
          pivot.position.copy(hinge);
          parent.add(pivot);
          const origPos = hn.position.clone();
          parent.remove(hn);
          pivot.add(hn);
          hn.position.set(origPos.x - hinge.x, origPos.y - hinge.y, origPos.z - hinge.z);
        }
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

    // تحميل نموذج العامل الحقيقي — نفس نمط السيارة (قالب واحد + استنساخ)،
    // مع فارق أن كل استنساخ يحتاج هيكلًا عظميًا مستقلًا (SkeletonUtils.clone)
    // حتى تتحرك كل نسخة بحركتها الخاصة دون التأثير على بقية العمّال.
    let workerTemplate: THREE.Group | null = null;
    let workerTemplateScale = 1;
    let workerAnimClip: THREE.AnimationClip | null = null;

    type WorkerSlot = {
      group: THREE.Group;
      mixer: THREE.AnimationMixer | null;
      spineBone: THREE.Object3D | null;
      bendP: number; // 0..1 تقدّم الانحناء للأمام
    };
    const workerSlots: WorkerSlot[] = [];

    function buildWorkerSlot(): WorkerSlot {
      if (workerTemplate) {
        const clone = skeletonClone(workerTemplate) as THREE.Group;
        clone.scale.setScalar(workerTemplateScale);
        let spineBone: THREE.Object3D | null = null;
        clone.traverse((o: any) => {
          if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
          if (o.isBone && o.name === WORKER_SPINE_BONE_NAME) spineBone = o;
        });
        const group = new THREE.Group();
        group.add(clone);
        let mixer: THREE.AnimationMixer | null = null;
        if (workerAnimClip) {
          mixer = new THREE.AnimationMixer(clone);
          const action = mixer.clipAction(workerAnimClip);
          action.play();
          // طور بداية عشوائي — حتى لا يتحرك كل العمّال بنفس الإيقاع معًا
          action.time = Math.random() * workerAnimClip.duration;
        }
        return { group, mixer, spineBone, bendP: 0 };
      }
      // بديل إجرائي فوري حتى يكتمل تحميل الملف (14MB)
      return { group: buildWorker(), mixer: null, spineBone: null, bendP: 0 };
    }

    const workerLoader = new GLTFLoader();
    workerLoader.load(
      WORKER_MODEL_URL,
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
        workerTemplateScale = WORKER_HEIGHT_TARGET / (size.y || 1);
        workerAnimClip = gltf.animations[0] || null;
        workerTemplate = root;
        // استبدل أي عمّال إجرائيين مؤقتين ظهروا قبل اكتمال التحميل بالنموذج الحقيقي
        workerSlots.forEach((slot, i) => {
          scene.remove(slot.group);
          slot.group.traverse((o: any) => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => m.dispose?.());
          });
          const fresh = buildWorkerSlot();
          fresh.group.position.copy(slot.group.position);
          fresh.group.rotation.copy(slot.group.rotation);
          scene.add(fresh.group);
          workerSlots[i] = fresh;
        });
      },
      undefined,
      () => { /* فشل التحميل — العمّال الإجرائيون يبقون كبديل دائم بصمت */ },
    );

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

    // عامل ثابت عند كل موقع من مواقع السير الأربعة — واقف عند مقدمة السيارة
    // (جهة الكبود) مواجهًا إياها، جاهزًا لينحني فوقها عندما تصل لحالة "working".
    for (const wz of LINE_SLOT_Z) {
      const slot = buildWorkerSlot();
      slot.group.position.set(LINE_X - 1.15, 0, wz);
      slot.group.rotation.y = Math.PI / 2;
      scene.add(slot.group);
      workerSlots.push(slot);
    }

    // معدات الورشة — عند طرفَي سير الخدمة، خارج مسار السيارات تمامًا، حتى
    // يبان المشهد كورشة حقيقية فيها أدوات ومعدات لا خط خدمة معزول في فراغ.
    const toolChest = buildToolChest();
    toolChest.position.set(LINE_X - 0.25, 0, LINE_HALF_LEN + 1.35);
    toolChest.rotation.y = 0.5;
    scene.add(toolChest);

    const drum1 = buildOilDrum(0x1d5fb4);
    drum1.position.set(LINE_X + 0.95, 0, LINE_HALF_LEN + 1.15);
    scene.add(drum1);
    const drum2 = buildOilDrum(0xe0a815);
    drum2.position.set(LINE_X + 1.55, 0, LINE_HALF_LEN + 1.55);
    scene.add(drum2);

    const tireStack = buildTireStack(4);
    tireStack.position.set(LINE_X - 0.2, 0, -LINE_HALF_LEN - 1.4);
    scene.add(tireStack);

    for (const [cx, cz] of [[LINE_X + 1.3, -LINE_HALF_LEN - 1.0], [LINE_X + 1.75, -LINE_HALF_LEN - 1.55]] as [number, number][]) {
      const cone = buildTrafficCone();
      cone.position.set(cx, 0, cz);
      scene.add(cone);
    }

    // إضاءة سقفية معلّقة فوق السير — أعلى بكثير من أي سيارة أو عامل، تضيف
    // طابع "ورشة صناعية" وتوهّج دافئ خفيف فوق منطقة العمل.
    for (const lz of [-1.6, 1.6]) {
      const lamp = buildHangingLight();
      lamp.position.set(LINE_X, 3.0, lz);
      scene.add(lamp);
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
      const hoodPivot = group.getObjectByName(HOOD_PIVOT_NAME) ?? null;
      const tc: TrackedCar = {
        id, plate, group, label: sprite, labelMat: mat, labelTex: tex,
        state: "entering", slot, bay: -1, x: startX, z: startZ, liftP: 0,
        bob: Math.random() * Math.PI * 2, doneWaiting: false,
        hoodPivot, hoodP: 0,
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

        // الكبود يُفتح فقط أثناء "working" الفعلية (بعد اكتمال الصعود على
        // السير)، ويُغلق تلقائيًا في أي حالة أخرى — نماذج السيارة الإجرائية
        // (البديل المؤقت) لا تملك hoodPivot فتتجاهل هذا بأمان.
        if (tc.hoodPivot) {
          const hoodTarget = tc.state === "working" ? 1 : 0;
          const hoodDur = reduceMotion ? 0.05 : 0.5;
          tc.hoodP += Math.sign(hoodTarget - tc.hoodP) * Math.min(Math.abs(hoodTarget - tc.hoodP), dt / hoodDur);
          tc.hoodPivot.rotation.z = THREE.MathUtils.degToRad(HOOD_OPEN_DEG * tc.hoodP);
        }
      });

      // لكل موقع من مواقع السير: حرّك أنيميشن وقوف العامل، وانحنِ للأمام فوق
      // الكبود فقط عندما توجد سيارة بنفس الفهرس في حالة "working" فعليًا.
      workerSlots.forEach((slot, i) => {
        if (!reduceMotion) slot.mixer?.update(dt);
        let active = false;
        tracked.forEach((c) => { if (c.bay === i && c.state === "working") active = true; });
        const bendTarget = active ? 1 : 0;
        const bendDur = reduceMotion ? 0.05 : 0.5;
        slot.bendP += Math.sign(bendTarget - slot.bendP) * Math.min(Math.abs(bendTarget - slot.bendP), dt / bendDur);
        if (slot.spineBone && slot.bendP > 0.001) {
          slot.spineBone.rotateX(THREE.MathUtils.degToRad(WORKER_BEND_DEG * slot.bendP));
        }
      });

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
      // وكذلك قالب العامل المحمَّل
      workerTemplate?.traverse((o: any) => {
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
