"use client";
// ═══════════════════════════════════════════════════════════════════════
// بانوراما ثلاثية الأبعاد حقيقية (WebGL / three.js) لمحطتَي "الانتظار" و"الخدمة"
// — سيارات/رافعة/عمّال مُبنية إجرائيًا بأشكال هندسية بسيطة (لا توجد أصول/ملفات
//   3D جاهزة في المشروع)، مع محرك حركة خاص خفيف يتبع حالة البيانات الحقيقية:
//   دخول سيارة للانتظار → تدخل وتنتظر في مكانها، انتقالها للخدمة → تتحرك إلى
//   الرافعة وترتفع ويعمل العمّال، وعند الخروج تنخفض الرافعة وتخرج السيارة.
// — يحترم الوضع الليلي/النهاري، وتفضيل "تقليل الحركة"، ويوقف العرض عند
//   اختفاء العنصر من الشاشة أو تبديل التبويب (حفاظًا على الأداء).
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useRef } from "react";
import * as THREE from "three";

export type BayCar = { id: string; plate?: string };

const PARK_SLOTS = 4;
const LIFT_BAYS = 2;
const PARK_X = 4.8;
const EXIT_X = 11;
const SLOT_Z = [-2.4, -0.8, 0.8, 2.4];
// كل رافعة مُعرّفة بموضعها [X, Z] — مفصولتان أفقيًا (X) لا بالعمق فقط،
// حتى لا تتراكبا بصريًا من زاوية الكاميرا (هذا كان سبب ظهورهما متداخلتين).
const BAY_POS: [number, number][] = [[-3.6, -0.15], [-7.2, 0.4]];
const LIFT_HEIGHT = 1.1;

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
  bay: number; // lift bay index, -1 if none
  x: number; z: number; // logical ground position (lift group sits on top separately)
  liftP: number; // 0..1 lift progress
  bob: number; // idle bob phase
};

function hashColor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const palette = [0x2e6bd6, 0x16a34a, 0xdc8a1d, 0x7c3aed, 0x0f9ba0, 0xb91c1c, 0x475569, 0xc2410c];
  return palette[h % palette.length];
}

function buildCar(color: number): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x22303f, roughness: 0.3, metalness: 0.4 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x181b20, roughness: 0.9 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.42, 0.95), bodyMat);
  body.position.y = 0.36;
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);

  // سقف منحدر بطابقين بدل صندوق واحد — يكسر الشكل الكتلي ويقرّب السيارة من الواقعية
  const roof = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.18, 0.78), bodyMat);
  roof.position.set(-0.14, 0.9, 0);
  roof.castShadow = true;
  g.add(roof);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.38, 0.86), glassMat);
  cabin.position.set(-0.1, 0.72, 0);
  cabin.castShadow = true;
  g.add(cabin);

  const bumperMat = new THREE.MeshStandardMaterial({ color: 0x20242b, roughness: 0.7 });
  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 1.0), bumperMat);
  bumperF.position.set(0.98, 0.22, 0);
  g.add(bumperF);
  const bumperR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 1.0), bumperMat);
  bumperR.position.set(-0.98, 0.22, 0);
  g.add(bumperR);

  const wheelGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.2, 14);
  const wheelPositions: [number, number][] = [[0.68, 0.47], [0.68, -0.47], [-0.68, 0.47], [-0.68, -0.47]];
  for (const [wx, wz] of wheelPositions) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(wx, 0.22, wz);
    wheel.castShadow = true;
    g.add(wheel);
  }

  const lightMat = new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0x4a3a00, emissiveIntensity: 0.4 });
  const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.65), lightMat);
  headlight.position.set(0.96, 0.4, 0);
  g.add(headlight);

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

function buildLift(x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x8a94a3, roughness: 0.5, metalness: 0.6 });
  const padMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.7 });

  const basePad = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.08, 1.3), padMat);
  basePad.position.y = 0.04;
  basePad.receiveShadow = true;
  g.add(basePad);

  const hazardMat = new THREE.MeshStandardMaterial({ color: 0xf2b800, roughness: 0.6 });
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.5, 0.16), pillarMat);
    pillar.position.set(side * 1.02, 1.25, -0.55);
    pillar.castShadow = true;
    g.add(pillar);
    const pillar2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.5, 0.16), pillarMat);
    pillar2.position.set(side * 1.02, 1.25, 0.55);
    pillar2.castShadow = true;
    g.add(pillar2);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 1.26), hazardMat);
    foot.position.set(side * 1.02, 0.1, 0);
    foot.castShadow = true;
    g.add(foot);
  }

  const beam = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.14, 0.16), pillarMat);
  beam.position.set(0, 2.48, -0.55);
  beam.castShadow = true;
  g.add(beam);
  const beam2 = beam.clone();
  beam2.position.z = 0.55;
  g.add(beam2);

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

    const groundMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 13), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // بلاطة خرسانية أفتح تحت منطقة الرافعات — تميّزها بصريًا عن أرضية الانتظار
    const padMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 4.6), padMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(-5.4, 0.006, 0.1);
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

    const lifts: THREE.Group[] = [];
    const platforms: THREE.Mesh[] = [];
    const workers: THREE.Group[] = [];
    const platMat = new THREE.MeshStandardMaterial({ color: 0x5b6472, roughness: 0.45, metalness: 0.55 });
    for (let i = 0; i < LIFT_BAYS; i++) {
      const [bx, bz] = BAY_POS[i];
      const lift = buildLift(bx, bz);
      scene.add(lift);
      lifts.push(lift);
      const plat = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.1, 1.05), platMat);
      plat.position.set(bx, 0.08, bz);
      plat.castShadow = true; plat.receiveShadow = true;
      scene.add(plat);
      platforms.push(plat);
      const worker = buildWorker();
      worker.position.set(bx + 1.55, 0, bz - 0.85);
      worker.rotation.y = 2.5;
      scene.add(worker);
      workers.push(worker);
    }

    function applyTheme(isDark: boolean) {
      dark = isDark;
      renderer.setClearColor(isDark ? 0x0b1220 : 0xeaf1fb, 1);
      groundMat.color.set(isDark ? 0x16233a : 0xdfe7f2);
      padMat.color.set(isDark ? 0x2a3a56 : 0xcdd7e6);
      scene.fog = new THREE.Fog(isDark ? 0x0b1220 : 0xeaf1fb, 10, 24);
    }
    applyTheme(dark);

    const tracked = new Map<string, TrackedCar>();
    const freeParkSlot = () => {
      const used = new Set<number>();
      tracked.forEach((c) => { if (c.slot >= 0 && c.state !== "leaving") used.add(c.slot); });
      for (let i = 0; i < PARK_SLOTS; i++) if (!used.has(i)) return i;
      return -1;
    };
    const freeLiftBay = () => {
      const used = new Set<number>();
      tracked.forEach((c) => { if (c.bay >= 0 && c.state !== "leaving") used.add(c.bay); });
      for (let i = 0; i < LIFT_BAYS; i++) if (!used.has(i)) return i;
      return -1;
    };

    function spawnCar(id: string, plate: string, directToLift: boolean): TrackedCar {
      const group = buildCar(hashColor(id));
      const { sprite, mat, tex } = makeLabelSprite(plate || "—", dark);
      sprite.position.set(0, 1.55, 0);
      group.add(sprite);
      scene.add(group);
      const slot = directToLift ? -1 : freeParkSlot();
      const startX = directToLift ? -EXIT_X : EXIT_X;
      const startZ = directToLift ? BAY_POS[0][1] : (slot >= 0 ? SLOT_Z[slot] : 0);
      group.position.set(startX, 0, startZ);
      group.rotation.y = directToLift ? Math.PI : Math.PI;
      const tc: TrackedCar = {
        id, plate, group, label: sprite, labelMat: mat, labelTex: tex,
        state: "entering", slot, bay: -1, x: startX, z: startZ, liftP: 0, bob: Math.random() * Math.PI * 2,
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
        if (tc.state === "entering" || tc.state === "parked") {
          const bay = freeLiftBay();
          if (bay >= 0) { tc.bay = bay; tc.slot = -1; tc.state = "toLift"; }
        }
      });
      tracked.forEach((tc, id) => {
        if (!qIds.has(id) && !sIds.has(id) && tc.state !== "leaving") {
          tc.state = tc.liftP > 0.02 ? "lowering" : "leaving";
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
        } else if (tc.state === "toLift") {
          const [bx, bz] = tc.bay >= 0 ? BAY_POS[tc.bay] : [0, 0];
          tc.x += Math.sign(bx - tc.x) * Math.min(Math.abs(bx - tc.x), speed * dt);
          tc.z += Math.sign(bz - tc.z) * Math.min(Math.abs(bz - tc.z), speed * dt);
          if (Math.abs(tc.x - bx) < 0.04 && Math.abs(tc.z - bz) < 0.04) {
            tc.x = bx; tc.z = bz; tc.state = "lifting";
          }
        } else if (tc.state === "lifting") {
          tc.liftP = Math.min(1, tc.liftP + dt / (reduceMotion ? 0.05 : 1.1));
          if (tc.liftP >= 1) tc.state = "working";
        } else if (tc.state === "working") {
          // يبقى مرفوعًا — العمّال يعملون
        } else if (tc.state === "lowering") {
          tc.liftP = Math.max(0, tc.liftP - dt / (reduceMotion ? 0.05 : 0.9));
          if (tc.liftP <= 0) tc.state = "leaving";
        } else if (tc.state === "leaving") {
          const exitX = tc.bay >= 0 ? -EXIT_X : EXIT_X + 2;
          tc.x += Math.sign(exitX - tc.x) * speed * 1.4 * dt;
          if (Math.abs(tc.x - exitX) < 0.3) {
            scene.remove(g);
            g.traverse((o: any) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => m.dispose?.()); });
            tc.labelTex.dispose(); tc.labelMat.dispose();
            tracked.delete(id);
            return;
          }
        }

        const bobY = (tc.state === "parked" && !reduceMotion) ? Math.sin(tc.bob) * 0.025 : 0;
        g.position.set(tc.x, bobY + tc.liftP * LIFT_HEIGHT, tc.z);
        const desiredYaw = tc.state === "entering" || tc.state === "toLift" || tc.state === "leaving" ? Math.PI : Math.PI;
        g.rotation.y += (desiredYaw - g.rotation.y) * Math.min(1, dt * 4);
      });

      if (!reduceMotion) {
        const anyWorking = Array.from(tracked.values()).some((c) => c.bay === 0 && (c.state === "working" || c.state === "lifting"));
        const anyWorking2 = Array.from(tracked.values()).some((c) => c.bay === 1 && (c.state === "working" || c.state === "lifting"));
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
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-petrol" /> رافعة الخدمة</span>
        </div>
      </div>
      <div ref={mountRef} className="h-[230px] w-full sm:h-[260px]" />
    </div>
  );
}
