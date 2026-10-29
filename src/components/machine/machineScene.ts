/**
 * machineScene.ts — 3D machine twin (three.js r128)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Motor → coupling → bearing (with the vibration sensor) → fan rotor.
 * Driven by the 8 sensor values and the AI fault result:
 *   velocity X/Y/Z  → machine shakes along that axis, sensor arrows grow
 *   acceleration    → bearing buzzes, glows, sparks
 *   temperature     → heat fills the motor bottom-up (orange ≥ warning, red ≥ critical), steam
 *   acoustic        → sound rings, bigger / faster when louder
 *   fault type      → only the faulty part is highlighted and named
 * Rendering pauses while the canvas is off screen or the tab is hidden.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type MachineFault = 'none' | 'bearing' | 'misalignment' | 'imbalance' | 'overheating' | 'vibration';
export type MachineStatus = 'normal' | 'warning' | 'critical';
export type Limits = Record<string, { warning: number; critical: number }>;

export interface MachineState {
  values: Record<string, number>;   // aRMSx … vRMSz, temperature, aucausticRMS
  fault: MachineFault;
  motorOff: boolean;
}

// Sensor mounting assumed: X sideways, Y vertical, Z along the shaft (confirm per installation)
const COLORS = {
  ok: '#22c55e', warn: '#f59e0b', crit: '#e53935', accent: '#1aa3ff',
  axisX: '#3b82f6', axisY: '#22d3ee', axisZ: '#a78bfa', panel: '#141a23',
};
export const DEFAULT_LIMITS: Limits = {
  vRMSx: { warning: 1.8, critical: 4.5 }, vRMSy: { warning: 1.8, critical: 4.5 }, vRMSz: { warning: 1.8, critical: 4.5 },
  aRMSx: { warning: 0.8, critical: 1.5 }, aRMSy: { warning: 0.8, critical: 1.5 }, aRMSz: { warning: 0.8, critical: 1.5 },
  temperature: { warning: 45, critical: 70 }, aucausticRMS: { warning: 65, critical: 80 },
};
const FIELDS = ['aRMSx', 'aRMSy', 'aRMSz', 'vRMSx', 'vRMSy', 'vRMSz', 'temperature', 'aucausticRMS'];
const SHAFT_Y = 1.32;
const HOME = new THREE.Vector3(6.4, 4.2, 7.6);
const TARGET = new THREE.Vector3(0.2, 1.0, 0);

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
type Lvl = 'ok' | 'warn' | 'crit';

interface Tag { el: HTMLDivElement; obj: THREE.Object3D; offset: THREE.Vector3; axis: boolean }

export class MachineScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  private controls: OrbitControls;
  private limits: Limits = DEFAULT_LIMITS;
  private state: MachineState = { values: {}, fault: 'none', motorOff: false };
  private shown: Record<string, number> = {};
  private raf = 0;
  private running = false;
  private onScreen = true;
  private last = performance.now();
  private rpm = 1;
  private angle = 0;
  private ringTimer = 0;
  private puffTimer = 0;
  private reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private tags: Tag[] = [];
  showLabels = true;
  private userMoved = false;      // keep the user's own view on resize
  private disposers: (() => void)[] = [];

  // parts
  private machine = new THREE.Group();
  private motor = new THREE.Group();
  private bearing = new THREE.Group();
  private sensor = new THREE.Group();
  private halfA = new THREE.Group();
  private halfB = new THREE.Group();
  private rotorPivot = new THREE.Group();
  private rotor = new THREE.Group();
  private shaft!: THREE.Mesh;
  private ringMat!: THREE.MeshStandardMaterial;
  private couplingMat!: THREE.MeshStandardMaterial;
  private weightMat!: THREE.MeshStandardMaterial;
  private rotorMat!: THREE.MeshStandardMaterial;
  private ledMat = new THREE.MeshBasicMaterial({ color: COLORS.ok });
  private axes!: Record<'x' | 'y' | 'z', THREE.ArrowHelper>;
  private heat = {
    uFill: { value: 0 }, uHeatColor: { value: new THREE.Color(COLORS.warn) }, uGlow: { value: 0 },
    uMinY: { value: 0.35 }, uMaxY: { value: 2.25 },
  };
  private puffs: THREE.Sprite[] = [];
  private rings: THREE.Mesh[] = [];
  private sparkGeo = new THREE.BufferGeometry();
  private sparkVel: THREE.Vector3[] = [];
  private sparkLife = new Float32Array(60);
  private tagMotor!: Tag; private tagCoupling!: Tag; private tagBearing!: Tag; private tagRotor!: Tag;
  private axisTags!: Record<'x' | 'y' | 'z', Tag>;

  constructor(private canvas: HTMLCanvasElement, private tagBox: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });   // throws if WebGL is unavailable
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.setClearColor(new THREE.Color(COLORS.panel));
    this.scene.fog = new THREE.Fog(new THREE.Color(COLORS.panel), 14, 30);

    this.camera.position.copy(HOME);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(TARGET);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 4.5;
    this.controls.maxDistance = 16;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.autoRotate = !this.reduceMotion;
    this.controls.autoRotateSpeed = 0.6;
    this.controls.addEventListener('start', () => { this.userMoved = true; });
    this.controls.update();

    this.buildScene();
    this.watchVisibility();
    for (const f of FIELDS) this.shown[f] = 0;
  }

  // ── Public API ───────────────────────────────────────────
  setState(state: MachineState) {
    const first = Object.keys(this.state.values).length === 0;
    this.state = state;
    if (first) for (const f of FIELDS) this.shown[f] = state.values[f] ?? 0;   // no fly-in on first data
  }
  setLimits(limits: Limits) { this.limits = { ...DEFAULT_LIMITS, ...limits }; }
  get autoRotate() { return this.controls.autoRotate; }
  set autoRotate(on: boolean) { this.controls.autoRotate = on; }
  resetView() {
    // Narrow / tall views need the camera further back to keep the whole machine in frame
    const fit = Math.max(1, 1.45 / Math.max(0.3, this.camera.aspect));
    this.camera.position.copy(TARGET).add(HOME.clone().sub(TARGET).multiplyScalar(fit));
    this.controls.target.copy(TARGET);
    this.controls.update();
  }

  /** Back to the default view (the Reset view button). */
  home() { this.userMoved = false; this.resetView(); }

  resize(width: number, height: number) {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    if (!this.userMoved) this.resetView();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      if (this.onScreen && document.visibilityState === 'visible') this.frame(now);
      else this.last = now;
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.disposers.forEach(d => d());
    this.controls.dispose();
    this.scene.traverse(o => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach(x => x.dispose());
    });
    this.renderer.dispose();
    this.tags.forEach(t => t.el.remove());
  }

  // ── Build ────────────────────────────────────────────────
  private M(color: number, opts: THREE.MeshStandardMaterialParameters = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.55, ...opts });
  }
  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, pos: [number, number, number] = [0, 0, 0]) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  }
  /** Material that fills with heat colour from the bottom up (world Y). */
  private heatMaterial(color: number, opts: THREE.MeshStandardMaterialParameters) {
    const m = this.M(color, opts);
    const heat = this.heat;
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, heat);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vWorldY;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldY = (modelMatrix * vec4(transformed, 1.0)).y;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vWorldY;\nuniform float uFill;\nuniform vec3 uHeatColor;\nuniform float uGlow;\nuniform float uMinY;\nuniform float uMaxY;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float h = (vWorldY - uMinY) / (uMaxY - uMinY);
          float heatMix = (1.0 - smoothstep(uFill - 0.12, uFill + 0.04, h)) * step(0.001, uFill);
          diffuseColor.rgb = mix(diffuseColor.rgb, uHeatColor, heatMix * 0.85);`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uHeatColor * heatMix * uGlow;');
    };
    return m;
  }

  private buildScene() {
    const { scene } = this;
    scene.add(new THREE.HemisphereLight(0xbfd6ff, 0x1a1f2a, 0.65));
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(5, 9, 6); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x1aa3ff, 0.45); rim.position.set(-6, 4, -6); scene.add(rim);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(12, 64), new THREE.MeshStandardMaterial({ color: 0x121821, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const grid = new THREE.GridHelper(24, 48, 0x24324a, 0x1a2333); grid.position.y = 0.002; scene.add(grid);

    const { machine, motor, bearing, sensor, halfA, halfB, rotorPivot, rotor } = this;
    scene.add(machine);
    this.mesh(new THREE.BoxGeometry(7.4, 0.28, 2.2), this.M(0x2b3442, { metalness: 0.4 }), machine, [0.4, 0.14, 0]);
    for (const z of [-0.95, 0.95]) this.mesh(new THREE.BoxGeometry(7.4, 0.12, 0.18), this.M(0xd9a400, { metalness: 0.3, roughness: 0.6 }), machine, [0.4, 0.34, z]);

    // motor
    motor.position.set(-1.9, SHAFT_Y, 0); machine.add(motor);
    const housing = this.mesh(new THREE.CylinderGeometry(0.82, 0.82, 2.3, 48), this.heatMaterial(0x31597e, { metalness: 0.45, roughness: 0.5 }), motor);
    housing.rotation.z = Math.PI / 2;
    const finMat = this.heatMaterial(0x284866, { metalness: 0.45, roughness: 0.55 });
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      this.mesh(new THREE.BoxGeometry(2.1, 0.1, 0.06), finMat, motor, [0, Math.sin(a) * 0.88, Math.cos(a) * 0.88]).rotation.x = -a;
    }
    const bellMat = this.heatMaterial(0x23384f, { metalness: 0.5, roughness: 0.45 });
    for (const x of [-1.2, 1.2]) this.mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.18, 48), bellMat, motor, [x, 0, 0]).rotation.z = Math.PI / 2;
    this.mesh(new THREE.CylinderGeometry(0.78, 0.86, 0.45, 40, 1, true), this.M(0x1d2b3b, { side: THREE.DoubleSide }), motor, [-1.5, 0, 0]).rotation.z = Math.PI / 2;
    this.mesh(new THREE.BoxGeometry(0.62, 0.42, 0.58), this.M(0x3a4a5e), motor, [0.15, 0.98, 0]);
    for (const x of [-0.75, 0.75]) for (const z of [-0.62, 0.62]) this.mesh(new THREE.BoxGeometry(0.34, 0.6, 0.26), this.M(0x23384f), motor, [x, -0.82, z]);

    // shaft
    const spin = new THREE.Group(); spin.position.set(0, SHAFT_Y, 0); machine.add(spin);
    this.shaft = this.mesh(new THREE.CylinderGeometry(0.11, 0.11, 4.6, 24), this.M(0xb8c2cf, { metalness: 0.9, roughness: 0.25 }), spin, [1.55, 0, 0]);
    this.shaft.rotation.z = Math.PI / 2;

    // coupling
    const coupling = new THREE.Group(); coupling.position.set(-0.2, SHAFT_Y, 0); machine.add(coupling);
    this.couplingMat = this.M(0x6b7787, { metalness: 0.8, roughness: 0.3 });
    coupling.add(halfA, halfB);
    for (const [g, x] of [[halfA, -0.17], [halfB, 0.17]] as const) {
      this.mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.3, 32), this.couplingMat, g, [x, 0, 0]).rotation.z = Math.PI / 2;
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        this.mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.34, 8), this.M(0x2a2f37), g, [x, Math.sin(a) * 0.25, Math.cos(a) * 0.25]).rotation.z = Math.PI / 2;
      }
    }

    // bearing + sensor
    bearing.position.set(1.2, 0, 0); machine.add(bearing);
    const bearingMat = this.M(0x3e4c5e, { metalness: 0.5 });
    this.mesh(new THREE.BoxGeometry(0.9, 0.26, 1.5), bearingMat, bearing, [0, 0.48, 0]);
    this.mesh(new THREE.BoxGeometry(0.55, 0.62, 0.8), bearingMat, bearing, [0, 0.9, 0]);
    this.ringMat = this.M(0x3e4c5e, { metalness: 0.6 });
    this.mesh(new THREE.TorusGeometry(0.4, 0.13, 16, 40), this.ringMat, bearing, [0, SHAFT_Y, 0]).rotation.y = Math.PI / 2;
    this.mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.55, 32), bearingMat, bearing, [0, SHAFT_Y, 0]).rotation.z = Math.PI / 2;
    sensor.position.set(0, SHAFT_Y + 0.48, 0); bearing.add(sensor);
    this.mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.2, 24), this.M(0x111820, { metalness: 0.3 }), sensor);
    this.mesh(new THREE.SphereGeometry(0.04, 12, 12), this.ledMat, sensor, [0.11, 0.08, 0.06]);
    this.mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 8), this.M(0x111820), sensor, [-0.2, 0.05, 0.2]).rotation.z = 1.2;
    const origin = new THREE.Vector3(0, 0.12, 0);
    this.axes = {
      x: new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), origin, 0.8, new THREE.Color(COLORS.axisX).getHex(), 0.16, 0.1),
      y: new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), origin, 0.8, new THREE.Color(COLORS.axisY).getHex(), 0.16, 0.1),
      z: new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), origin, 0.8, new THREE.Color(COLORS.axisZ).getHex(), 0.16, 0.1),
    };
    Object.values(this.axes).forEach(a => sensor.add(a));

    // fan rotor
    rotorPivot.position.set(3.3, SHAFT_Y, 0); machine.add(rotorPivot); rotorPivot.add(rotor);
    this.rotorMat = this.M(0x8a96a6, { metalness: 0.75, roughness: 0.3 });
    this.mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.4, 32), this.rotorMat, rotor).rotation.z = Math.PI / 2;
    this.mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.08, 64), this.rotorMat, rotor).rotation.z = Math.PI / 2;
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      const blade = this.mesh(new THREE.BoxGeometry(0.36, 0.62, 0.05), this.M(0x9aa6b5, { metalness: 0.7 }), rotor, [0.16, Math.sin(a) * 0.62, Math.cos(a) * 0.62]);
      blade.rotation.x = -a; blade.rotation.y = 0.35;
    }
    this.weightMat = this.M(0x5b6675, { metalness: 0.6 });
    this.mesh(new THREE.BoxGeometry(0.14, 0.18, 0.18), this.weightMat, rotor, [-0.08, 0.86, 0]);
    this.mesh(new THREE.TorusGeometry(1.12, 0.035, 8, 64), this.M(0xd9a400, { metalness: 0.3 }), rotorPivot).rotation.y = Math.PI / 2;
    this.mesh(new THREE.BoxGeometry(0.4, 1.1, 0.5), this.M(0x2b3442), machine, [3.65, 0.83, 0]);

    this.buildEffects();
    this.buildTags();
  }

  private buildEffects() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!;
    for (const [x, y, r] of [[64, 70, 40], [40, 76, 26], [88, 74, 28], [58, 48, 28], [80, 52, 22]]) {
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.95)'); grd.addColorStop(0.7, 'rgba(235,240,248,0.75)'); grd.addColorStop(1, 'rgba(235,240,248,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
    for (let i = 0; i < (this.reduceMotion ? 10 : 28); i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
      s.userData = { life: 1, speed: 0, size: 0.5, drift: 0 }; this.scene.add(s); this.puffs.push(s);
    }
    for (let i = 0; i < 6; i++) {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.9, 0.97, 64),
        new THREE.MeshBasicMaterial({ color: COLORS.accent, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
      r.userData = { life: 1 }; this.scene.add(r); this.rings.push(r);
    }
    this.sparkGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(this.sparkLife.length * 3), 3));
    this.sparkVel = Array.from({ length: this.sparkLife.length }, () => new THREE.Vector3());
    this.scene.add(new THREE.Points(this.sparkGeo, new THREE.PointsMaterial({
      color: 0xffc061, size: 0.07, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })));
  }

  private addTag(text: string, obj: THREE.Object3D, offset: [number, number, number], axis = false): Tag {
    const el = document.createElement('div');
    el.className = axis ? 'machine-tag machine-tag-axis' : 'machine-tag';
    el.textContent = text;
    this.tagBox.appendChild(el);
    const t = { el, obj, offset: new THREE.Vector3(...offset), axis };
    this.tags.push(t); return t;
  }

  private buildTags() {
    this.tagMotor = this.addTag('Motor', this.motor, [0, 1.35, 0]);
    this.tagCoupling = this.addTag('Coupling', this.halfB.parent!, [0, 0.7, 0]);
    this.tagBearing = this.addTag('Bearing + sensor', this.bearing, [0, 2.35, 0]);
    this.tagRotor = this.addTag('Fan rotor', this.rotorPivot, [0, 1.35, 0]);
    this.axisTags = {
      x: this.addTag('X', this.sensor, [0, 0.12, 1.05], true),
      y: this.addTag('Y', this.sensor, [0, 1.05, 0], true),
      z: this.addTag('Z', this.sensor, [1.05, 0.12, 0], true),
    };
  }

  private watchVisibility() {
    const io = new IntersectionObserver(([e]) => { this.onScreen = e.isIntersecting; });
    io.observe(this.canvas);
    this.disposers.push(() => io.disconnect());
  }

  // ── Animation ────────────────────────────────────────────
  private level(field: string, v: number): Lvl {
    const l = this.limits[field];
    if (!l) return 'ok';
    return v >= l.critical ? 'crit' : v >= l.warning ? 'warn' : 'ok';
  }

  private glow(mat: THREE.MeshStandardMaterial, color: string | null, strength: number) {
    mat.emissive.set(color ?? 0x000000); mat.emissiveIntensity = color ? strength : 0;
  }

  private setTag(t: Tag, text: string, lvl: Lvl) {
    if (t.el.textContent !== text) t.el.textContent = text;
    t.el.dataset.level = lvl;
  }

  private frame(now: number) {
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    const { values, fault, motorOff } = this.state;
    for (const f of FIELDS) this.shown[f] += ((values[f] ?? 0) - this.shown[f]) * Math.min(1, dt * 4);
    const v = this.shown, t = now / 1000, motion = this.reduceMotion ? 0.25 : 1;
    const tmp = new THREE.Vector3();
    const col = { ok: COLORS.ok, warn: COLORS.warn, crit: COLORS.crit };

    // rotation (spins down when the motor is off)
    this.rpm += ((motorOff ? 0 : 1) - this.rpm) * Math.min(1, dt * 1.2);
    this.angle += dt * 9 * this.rpm;
    this.shaft.rotation.x = this.angle; this.halfA.rotation.x = this.angle; this.halfB.rotation.x = this.angle; this.rotor.rotation.x = this.angle;

    // velocity → shake along sensor axes (X sideways = world Z, Y up, Z along shaft = world X)
    const amp = (f: string) => motion * this.rpm * 0.055 * clamp01((v[f] - 0.4) / 9.6) ** 0.8;
    this.machine.position.set(amp('vRMSz') * Math.sin(t * 47 + 1.3), amp('vRMSy') * Math.sin(t * 53), amp('vRMSx') * Math.sin(t * 41 + 0.7));
    const axisDefs: ['x' | 'y' | 'z', string, string, [number, number, number]][] = [
      ['x', 'vRMSx', COLORS.axisX, [0, 0.12, 1]], ['y', 'vRMSy', COLORS.axisY, [0, 1, 0]], ['z', 'vRMSz', COLORS.axisZ, [1, 0.12, 0]]];
    for (const [k, f, base, dir] of axisDefs) {
      const L = this.level(f, v[f]);
      const len = 0.45 + Math.min(1.6, v[f] * 0.17);
      this.axes[k].setLength(len, 0.16, 0.1);
      const pulse = L === 'ok' ? 1 : 0.6 + 0.4 * Math.abs(Math.sin(t * (L === 'crit' ? 8 : 4)));
      this.axes[k].setColor(new THREE.Color(L === 'ok' ? base : col[L]).multiplyScalar(pulse));
      this.axisTags[k].offset.set(dir[0] * (len + 0.2), k === 'y' ? len + 0.25 : dir[1], dir[2] * (len + 0.2));
      this.setTag(this.axisTags[k], `${k.toUpperCase()} ${v[f].toFixed(1)}`, L);
    }

    // acceleration → bearing
    const amax = Math.max(v.aRMSx, v.aRMSy, v.aRMSz), vmax = Math.max(v.vRMSx, v.vRMSy, v.vRMSz);
    const accL = (['aRMSx', 'aRMSy', 'aRMSz'] as const).map(f => this.level(f, v[f]))
      .reduce<Lvl>((m, l) => (l === 'crit' || m === 'crit' ? 'crit' : l === 'warn' || m === 'warn' ? 'warn' : 'ok'), 'ok');
    const isBearing = fault === 'bearing', isMis = fault === 'misalignment', isImb = fault === 'imbalance';
    const jit = motion * this.rpm * 0.025 * Math.max(isBearing ? 1 : 0, clamp01((amax - 0.35) / 1.0));
    this.bearing.position.set(1.2 + (Math.random() - .5) * jit, (Math.random() - .5) * jit, (Math.random() - .5) * jit);
    const bLvl: Lvl = isBearing ? 'crit' : accL;
    this.glow(this.ringMat, bLvl === 'ok' ? null : col[bLvl], (0.6 + 0.6 * Math.abs(Math.sin(t * 9))) * (bLvl === 'crit' ? 1.4 : 0.8));
    const sparkRate = (isBearing || accL === 'crit') && this.rpm > 0.3 ? (this.reduceMotion ? 10 : 60) : accL === 'warn' && this.rpm > 0.3 ? 12 : 0;
    const pos = this.sparkGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < this.sparkLife.length; i++) {
      if (this.sparkLife[i] <= 0 && Math.random() < sparkRate * dt / this.sparkLife.length * 6) {
        this.bearing.getWorldPosition(tmp); tmp.y += SHAFT_Y; tmp.z += 0.45 * (Math.random() > .5 ? 1 : -1);
        pos.setXYZ(i, tmp.x, tmp.y, tmp.z);
        this.sparkVel[i].set((Math.random() - .5) * 2.5, Math.random() * 2.5 + 1, (Math.random() - .5) * 2.5);
        this.sparkLife[i] = 0.5 + Math.random() * 0.4;
      }
      if (this.sparkLife[i] > 0) {
        this.sparkLife[i] -= dt; this.sparkVel[i].y -= 9 * dt;
        pos.setXYZ(i, pos.getX(i) + this.sparkVel[i].x * dt, pos.getY(i) + this.sparkVel[i].y * dt, pos.getZ(i) + this.sparkVel[i].z * dt);
      } else pos.setXYZ(i, 0, -50, 0);
    }
    pos.needsUpdate = true;

    // misalignment → coupling half offsets + glows
    const mis = (isMis ? 1 : 0) * motion;
    this.halfA.position.set(0, 0.07 * mis, 0.06 * mis); this.halfA.rotation.z = 0.12 * mis;
    this.glow(this.couplingMat, isMis ? col.crit : null, 0.5 + 0.5 * Math.abs(Math.sin(t * 6)));

    // imbalance → rotor wobble + heavy spot
    const imb = Math.max(isImb ? 1 : 0, 0.15 * clamp01((vmax - 1.8) / 3)) * motion * this.rpm;
    this.rotorPivot.rotation.y = 0.09 * imb * Math.sin(this.angle); this.rotorPivot.rotation.z = 0.09 * imb * Math.cos(this.angle);
    this.glow(this.weightMat, isImb ? col.crit : null, 1.2);
    this.glow(this.rotorMat, isImb ? col.crit : null, 0.18 + 0.12 * Math.sin(t * 6));

    // temperature → heat bottom-up + steam
    const temp = v.temperature, tl = this.limits.temperature ?? DEFAULT_LIMITS.temperature, tLvl = this.level('temperature', temp);
    this.heat.uFill.value = clamp01((temp - (tl.warning - 13)) / (tl.critical - tl.warning + 15));
    this.heat.uHeatColor.value.set(temp >= tl.critical ? col.crit : temp >= tl.warning ? col.warn : '#d4a94a');
    this.heat.uGlow.value = temp >= tl.critical ? 0.55 + 0.25 * Math.sin(t * 3) : temp >= tl.warning ? 0.3 : 0.08;
    this.puffTimer += dt * (temp >= tl.critical ? 7 : temp >= tl.warning ? 2.5 : 0);
    for (const p of this.puffs) {
      const u = p.userData as { life: number; speed: number; size: number; drift: number };
      const mat = p.material as THREE.SpriteMaterial;
      if (this.puffTimer >= 1 && u.life >= 1) {
        this.puffTimer -= 1; this.motor.getWorldPosition(tmp);
        p.position.set(tmp.x + (Math.random() - .5) * 1.8, tmp.y + 0.9, tmp.z + (Math.random() - .5) * 0.8);
        Object.assign(u, { life: 0, speed: 0.6 + Math.random() * 0.5, size: 0.5 + Math.random() * 0.4, drift: (Math.random() - .5) * 0.4 });
      }
      if (u.life < 1) {
        u.life += dt / 2.6;
        p.position.y += u.speed * dt; p.position.x += u.drift * dt;
        const s = u.size * (0.6 + u.life * 1.4); p.scale.set(s, s, s);
        mat.opacity = Math.sin(Math.PI * Math.min(1, u.life)) * (temp >= tl.critical ? 0.85 : 0.6);
      } else mat.opacity = 0;
    }
    if (this.puffTimer > 3) this.puffTimer = 3;

    // acoustic → sound rings
    const db = v.aucausticRMS, aLvl = this.level('aucausticRMS', db);
    this.ringTimer += dt * (this.rpm > 0.2 ? clamp01((db - 40) / 110) * 2.2 : 0);
    for (const r of this.rings) {
      const u = r.userData as { life: number };
      const mat = r.material as THREE.MeshBasicMaterial;
      if (this.ringTimer >= 1 && u.life >= 1) { this.ringTimer -= 1; u.life = 0; mat.color.set(aLvl === 'ok' ? COLORS.accent : col[aLvl]); }
      if (u.life < 1) {
        u.life += dt / 1.6;
        const s = 0.9 + u.life * (0.8 + clamp01((db - 40) / 110) * 1.6);
        this.motor.getWorldPosition(tmp); r.position.set(tmp.x + 1.6, tmp.y, tmp.z);
        r.quaternion.copy(this.camera.quaternion); r.scale.set(s, s, s);
        mat.opacity = (1 - u.life) * 0.45;
      } else mat.opacity = 0;
    }
    if (this.ringTimer > 3) this.ringTimer = 3;

    this.ledMat.color.set(motorOff ? COLORS.ok : (fault !== 'none' && fault !== 'overheating') ? COLORS.crit : COLORS.ok);
    this.setTag(this.tagMotor, temp >= tl.warning ? `Motor · ${temp.toFixed(0)} °C` : 'Motor', tLvl);
    this.setTag(this.tagCoupling, isMis ? 'Coupling · misaligned' : 'Coupling', isMis ? 'crit' : 'ok');
    this.setTag(this.tagBearing, isBearing ? 'Bearing · fault' : accL !== 'ok' ? `Bearing · ${amax.toFixed(2)} g` : 'Bearing + sensor', isBearing ? 'crit' : accL);
    this.setTag(this.tagRotor, isImb ? 'Fan rotor · imbalance' : 'Fan rotor', isImb ? 'crit' : 'ok');

    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    for (const tg of this.tags) {
      const flagged = !tg.axis && tg.el.dataset.level !== 'ok';
      if (!this.showLabels && !flagged) { tg.el.hidden = true; continue; }
      tg.obj.getWorldPosition(tmp); tmp.add(tg.offset); tmp.project(this.camera);
      const visible = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
      tg.el.hidden = !visible;
      if (visible) tg.el.style.transform = `translate(${(tmp.x * .5 + .5) * w}px, ${(-tmp.y * .5 + .5) * h}px) translate(-50%, ${tg.axis ? '-50%' : '-100%'})`;
    }
  }
}
