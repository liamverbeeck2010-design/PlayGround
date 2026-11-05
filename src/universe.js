import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import {
  BODY_TYPES,
  getSurface,
  getCloudTexture,
  getRingTexture,
  getGlowTexture,
  getReticleTexture,
  getMiniGlowTexture,
} from "./textures.js";

const TAU = Math.PI * 2;
const G = 1;
const STAR_MASS = 520;
const PLANET_GRAVITY_SCALE = 0.16;
const STAR_RADIUS = 4.6;
const HABITABLE_INNER = 15.8;
const HABITABLE_OUTER = 22.5;
const WORLD_NAMES = [
  "Aster", "Vesper", "Thalassa", "Orin", "Ilos", "Khepri", "Sable", "Yara",
  "Caelum", "Nadir", "Eos", "Morrow", "Tethys", "Rook", "Vela", "Orison",
  "Ardent", "Lumen", "Serein", "Kestrel", "Oberon", "Alcyone",
];
const MOON_NAMES = ["Rill", "Tide", "Wisp", "Mica", "Pip", "Cinder", "Lark", "Nix"];
const COMET_NAMES = ["Kite", "Ember", "Wraith", "Needle", "Morrow", "Sable"];

const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

const starVertex = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vPos = position;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const starFragment = /* glsl */ `
  uniform float uTime;
  varying vec3 vPos;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  ${NOISE_GLSL}
  void main() {
    vec3 n = normalize(vPos);
    float t = uTime;
    float n1 = snoise(n * 3.1 + vec3(0.0, t * 0.045, t * 0.012));
    float n2 = snoise(n * 8.4 - vec3(t * 0.08, 0.0, t * 0.05));
    float n3 = snoise(n * 18.0 + vec3(t * 0.12, -t * 0.07, t * 0.04));
    float heat = clamp(0.53 + n1 * 0.3 + n2 * 0.2 + n3 * 0.12, 0.0, 1.0);

    vec3 col = mix(vec3(0.43, 0.055, 0.006), vec3(1.0, 0.35, 0.035), smoothstep(0.04, 0.62, heat));
    col = mix(col, vec3(1.0, 0.68, 0.22), smoothstep(0.55, 0.82, heat));
    col = mix(col, vec3(1.0, 0.93, 0.7), smoothstep(0.82, 1.0, heat));
    col += vec3(1.0, 0.62, 0.16) * pow(max(n2, 0.0), 5.0) * 0.7;

    vec3 V = normalize(cameraPosition - vWorld);
    float limb = pow(1.0 - max(dot(vNormalW, V), 0.0), 2.2);
    col += vec3(1.0, 0.31, 0.025) * limb * 1.4;

    gl_FragColor = vec4(col, 1.0);
  }
`;

const bgVertex = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const bgFragment = /* glsl */ `
  varying vec3 vDirection;
  ${NOISE_GLSL}
  void main() {
    vec3 d = normalize(vDirection);
    float h = smoothstep(-0.78, 0.9, d.y);
    vec3 col = mix(vec3(0.0022, 0.0042, 0.0095), vec3(0.006, 0.011, 0.023), h);

    float band = exp(-pow((dot(d, normalize(vec3(0.32, 0.82, -0.46))) + 0.12) / 0.3, 2.0));
    col += vec3(0.036, 0.032, 0.054) * band;

    float n = snoise(d * 2.6) * 0.5 + 0.5;
    float n2 = snoise(d * 5.5 + vec3(7.1, 2.3, 4.8)) * 0.5 + 0.5;
    float mistA = exp(-pow(length(d - normalize(vec3(-0.56, 0.33, -0.76))) / 0.46, 2.0));
    float mistB = exp(-pow(length(d - normalize(vec3(0.78, -0.15, -0.4))) / 0.38, 2.0));
    float mistC = exp(-pow(length(d - normalize(vec3(0.2, 0.44, -0.9))) / 0.23, 2.0));
    col += vec3(0.018, 0.047, 0.052) * mistA * (0.45 + n * 0.8);
    col += vec3(0.048, 0.025, 0.063) * mistB * (0.4 + n2 * 0.72);
    col += vec3(0.05, 0.025, 0.012) * mistC * (0.35 + n * 0.4);

    // Gentle micro-stars baked behind the point field.
    float stars = step(0.9986, n2 * 0.75 + n * 0.25);
    col += vec3(0.45, 0.52, 0.62) * stars * 0.5;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const atmosphereVertex = /* glsl */ `
  varying vec3 vNormalV;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const atmosphereFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec3 vNormalV;
  varying vec3 vView;
  void main() {
    float rim = pow(1.0 - max(dot(vNormalV, vView), 0.0), 3.1);
    float alpha = rim * uStrength;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function circlePoints(radius, count = 160, y = 0.002) {
  const pts = [];
  for (let i = 0; i <= count; i++) {
    const a = (i / count) * TAU;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
  }
  return pts;
}

function orbitPosition(radius, angle, y = 0) {
  return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
}

function circularVelocity(radius, angle, centralMass) {
  const speed = Math.sqrt((G * centralMass) / radius);
  return new THREE.Vector3(-Math.sin(angle) * speed, 0, Math.cos(angle) * speed);
}

function tangent(angle) {
  return new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
}

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Universe {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.bodies = [];
    this.worlds = [];
    this.moons = [];
    this.comets = [];
    this.particles = [];
    this.bodyCounter = 0;
    this.selectedId = null;
    this.focusId = null;
    this.focusState = null;
    this.timeScale = 1;
    this.paused = false;
    this.simTime = 0;
    this.realTime = 0;
    this.trailClock = 0;
    this.snapshotClock = 0;
    this.shake = 0;
    this.pointerDown = null;
    this.raycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();
    this.usedNames = new Set();
    this.usedMoonNames = new Set();
    this.usedCometNames = new Set();
    this.ghost = null;
    this.hoverId = null;

    this.initScene();
    this.initLights();
    this.initStarfield();
    this.initEcliptic();
    this.initStar();
    this.initSystem();
    this.initControls();
    this.ensureReticle();
    this.initPost();
    this.resize();
    this.fitSystem(true);

    this.clock = new THREE.Clock();
    this.quality = {
      baseDpr: this.renderer.getPixelRatio(),
      level: 0,
      frames: 0,
      elapsed: 0,
      warmup: 2.5,
    };
    document.addEventListener("visibilitychange", () => {
      this.quality.frames = 0;
      this.quality.elapsed = 0;
    });
    this.renderer.setAnimationLoop(() => this.tick());
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("orientationchange", () => setTimeout(() => this.resize(), 250));
  }

  adaptQuality(frameDt) {
    const q = this.quality;
    if (!q || document.visibilityState !== "visible" || q.level >= 2) return;
    q.elapsed += frameDt;
    q.frames += 1;
    if (q.elapsed < q.warmup || q.frames < 20) return;
    const fps = q.frames / q.elapsed;
    q.elapsed = 0;
    q.frames = 0;
    if (fps >= 25) return;

    q.level += 1;
    if (q.level === 1) {
      const dpr = Math.max(0.9, q.baseDpr * 0.72);
      this.renderer.setPixelRatio(dpr);
      this.bloom.strength *= 0.88;
      this.resize();
    } else {
      this.renderer.setPixelRatio(Math.max(0.7, q.baseDpr * 0.58));
      this.bloom.enabled = false;
      this.resize();
    }
    this.callbacks.onQualityChange?.(q.level);
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x02040a, 0.0022);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 700);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      stencil: false,
    });
    this.renderer.setClearColor(0x02040a, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.93;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.container.appendChild(this.renderer.domElement);
    this.isMobile = matchMedia("(max-width: 700px), (pointer: coarse)").matches;
    if (this.isMobile) this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));
    this.resize();
  }

  initLights() {
    this.scene.add(new THREE.AmbientLight(0x3c506d, 0.4));
    const hemi = new THREE.HemisphereLight(0x45658c, 0x140d0d, 0.32);
    this.scene.add(hemi);
    this.sunLight = new THREE.PointLight(0xffddb8, 600, 0, 1.3);
    this.scene.add(this.sunLight);
  }

  initPost() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      this.isMobile ? 0.46 : 0.56,
      0.46,
      0.78
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  initStarfield() {
    const makeField = (count, minR, maxR, size, opacity, colorSeed) => {
      const rand = makeRng(colorSeed);
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      const palette = [
        new THREE.Color(0xb8d6ff),
        new THREE.Color(0xf8eed2),
        new THREE.Color(0xffcf9c),
        new THREE.Color(0xd6c5ff),
        new THREE.Color(0xffffff),
      ];
      for (let i = 0; i < count; i++) {
        const u = rand() * 2 - 1;
        const theta = rand() * TAU;
        const s = Math.sqrt(1 - u * u);
        const r = minR + rand() * (maxR - minR);
        positions[i * 3] = Math.cos(theta) * s * r;
        positions[i * 3 + 1] = u * r;
        positions[i * 3 + 2] = Math.sin(theta) * s * r;
        const c = palette[Math.floor(rand() * palette.length)].clone();
        c.multiplyScalar(0.55 + rand() * 0.65);
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.PointsMaterial({
        size,
        map: getMiniGlowTexture(),
        vertexColors: true,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
        alphaTest: 0.01,
      });
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      this.scene.add(points);
      return points;
    };
    this.starfield = makeField(2100, 170, 300, 1.15, 0.88, 101);
    this.brightStars = makeField(115, 155, 280, 2.4, 0.8, 202);
    this.dust = makeField(420, 35, 90, 0.38, 0.22, 303);

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(340, 32, 20),
      new THREE.ShaderMaterial({
        vertexShader: bgVertex,
        fragmentShader: bgFragment,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      })
    );
    sky.renderOrder = -100;
    this.scene.add(sky);
  }

  initEcliptic() {
    this.orbitGroup = new THREE.Group();
    this.scene.add(this.orbitGroup);

    const radii = [10.6, 17.2, 27.0, 41.5];
    radii.forEach((r, i) => {
      const mat = new THREE.LineBasicMaterial({
        color: i === 1 ? 0x6bbda7 : 0x8fa4b8,
        transparent: true,
        opacity: i === 1 ? 0.12 : 0.075,
        depthWrite: false,
      });
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(circlePoints(r)), mat);
      this.orbitGroup.add(line);
    });

    const gridMat = new THREE.LineBasicMaterial({
      color: 0x7f93a8,
      transparent: true,
      opacity: 0.022,
      depthWrite: false,
    });
    for (let i = 1; i <= 6; i++) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(circlePoints(i * 8)), gridMat);
      this.orbitGroup.add(line);
    }
    const spokePts = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      spokePts.push(new THREE.Vector3(Math.cos(a) * 8, 0, Math.sin(a) * 8));
      spokePts.push(new THREE.Vector3(Math.cos(a) * 48, 0, Math.sin(a) * 48));
    }
    const spokes = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(spokePts), gridMat);
    this.orbitGroup.add(spokes);

    const zoneMat = new THREE.MeshBasicMaterial({
      color: 0x51cba4,
      transparent: true,
      opacity: 0.026,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.habitableBand = new THREE.Mesh(
      new THREE.RingGeometry(HABITABLE_INNER, HABITABLE_OUTER, 128),
      zoneMat
    );
    this.habitableBand.rotation.x = -Math.PI / 2;
    this.habitableBand.position.y = 0.004;
    this.scene.add(this.habitableBand);

    const edgeMat = new THREE.LineBasicMaterial({
      color: 0x72d9bb,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    this.habitableEdges = [
      new THREE.Line(new THREE.BufferGeometry().setFromPoints(circlePoints(HABITABLE_INNER)), edgeMat),
      new THREE.Line(new THREE.BufferGeometry().setFromPoints(circlePoints(HABITABLE_OUTER)), edgeMat),
    ];
    this.habitableEdges.forEach((l) => this.scene.add(l));
    this.habitableAnchor = new THREE.Vector3(0, 0.2, -18.8);

    this.selectionOrbit = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(circlePoints(1)),
      new THREE.LineBasicMaterial({
        color: 0xf0c27e,
        transparent: true,
        opacity: 0.33,
        depthWrite: false,
      })
    );
    this.selectionOrbit.visible = false;
    this.scene.add(this.selectionOrbit);

    this.ghostGroup = new THREE.Group();
    this.ghostGroup.visible = false;
    this.ghostOrbit = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(circlePoints(1)),
      new THREE.LineBasicMaterial({
        color: 0xe9c68d,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      })
    );
    this.ghostGroup.add(this.ghostOrbit);
    this.ghostMaterial = new THREE.MeshBasicMaterial({ color: 0x8edbd4, transparent: true, opacity: 0.5 });
    this.ghostMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), this.ghostMaterial);
    this.ghostGroup.add(this.ghostMesh);
    this.ghostHalo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getMiniGlowTexture(),
        color: 0x92e4db,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.ghostGroup.add(this.ghostHalo);
    this.scene.add(this.ghostGroup);

    this.belt = this.createBelt();
  }

  createBelt() {
    const count = 210;
    const geo = new THREE.IcosahedronGeometry(0.12, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x8c877c,
      roughness: 0.95,
      metalness: 0.06,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.frustumCulled = false;
    const rand = makeRng(551);
    const rocks = [];
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const radius = 23.1 + rand() * 3.3;
      const angle = rand() * TAU;
      const y = (rand() - 0.5) * 0.7;
      const size = 0.35 + rand() * 1.5;
      rocks.push({ radius, angle, y, size, speed: (0.012 + rand() * 0.018) / Math.sqrt(radius / 20) });
      dummy.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      dummy.rotation.set(rand() * TAU, rand() * TAU, rand() * TAU);
      dummy.scale.setScalar(size);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.beltRocks = rocks;
    this.beltDummy = dummy;
    this.scene.add(mesh);
    return mesh;
  }

  initStar() {
    const starGroup = new THREE.Group();
    this.starGroup = starGroup;
    this.scene.add(starGroup);

    this.starMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: starVertex,
      fragmentShader: starFragment,
    });
    this.starMesh = new THREE.Mesh(new THREE.SphereGeometry(STAR_RADIUS, 64, 48), this.starMaterial);
    this.starMesh.userData.bodyId = "star";
    starGroup.add(this.starMesh);

    const glowSpecs = [
      { scale: 13, opacity: 0.9, color: 0xffe4b3 },
      { scale: 22, opacity: 0.42, color: 0xffb265 },
      { scale: 40, opacity: 0.16, color: 0xff7b38 },
      { scale: 72, opacity: 0.06, color: 0xd94b28 },
    ];
    this.starArcs = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(STAR_RADIUS * (1.06 + i * 0.035), 0.055 + i * 0.012, 6, 90, Math.PI * (1.05 + i * 0.10)),
        new THREE.MeshBasicMaterial({
          color: i === 0 ? 0xffc067 : i === 1 ? 0xff7e35 : 0xffdf9e,
          transparent: true,
          opacity: 0.17 - i * 0.035,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      arc.rotation.set(Math.PI * (0.35 + i * 0.14), Math.PI * (0.12 + i * 0.28), Math.PI * (0.10 + i * 0.16));
      arc.userData.speed = 0.025 + i * 0.012;
      this.starArcs.add(arc);
    }
    starGroup.add(this.starArcs);

    this.starGlows = glowSpecs.map((spec, i) => {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: getGlowTexture(),
          color: spec.color,
          transparent: true,
          opacity: spec.opacity,
          depthWrite: false,
          depthTest: i === 0,
          blending: THREE.AdditiveBlending,
        })
      );
      sprite.scale.setScalar(spec.scale);
      sprite.renderOrder = i === 0 ? 2 : 1;
      starGroup.add(sprite);
      return { sprite, baseScale: spec.scale, baseOpacity: spec.opacity, phase: i * 1.7 };
    });

    this.star = {
      id: "star",
      name: "Helios",
      type: "star",
      isStar: true,
      mass: STAR_MASS,
      radius: STAR_RADIUS,
      pos: new THREE.Vector3(0, 0, 0),
      vel: new THREE.Vector3(),
      group: starGroup,
    };
    this.bodies.push(this.star);
  }

  initSystem() {
    this.suppressEvents = true;
    this.addWorld("desert", 10.6, 0.58, "Cinder");
    this.addWorld("ocean", 17.2, 2.48, "Pelagos");
    this.addWorld("gas", 27.0, 3.88, "Aurelia");
    this.addWorld("ice", 41.5, 5.52, "Nyx");
    const pelagos = this.worlds.find((w) => w.name === "Pelagos");
    if (pelagos) this.spawnMoon(pelagos, 3.7, 1.2, "Rill");
    this.usedNames = new Set(["Cinder", "Pelagos", "Aurelia", "Nyx"]);
    this.suppressEvents = false;
  }

  initControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.058;
    this.controls.rotateSpeed = 0.52;
    this.controls.zoomSpeed = 0.78;
    this.controls.panSpeed = 0.5;
    this.controls.enablePan = false;
    this.controls.minDistance = 7.5;
    this.controls.maxDistance = 185;
    this.controls.minPolarAngle = 0.16;
    this.controls.maxPolarAngle = Math.PI * 0.475;
    this.controls.target.set(0, 0, 0);
    this.controls.touches.ONE = THREE.TOUCH.ROTATE;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
    this.controls.update();

    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
    canvas.addEventListener("pointerup", (e) => this.onPointerUp(e));
    canvas.addEventListener("pointercancel", () => { this.pointerDown = null; });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    this.controls.addEventListener("start", () => {
      this.callbacks.onCameraInteract?.();
    });
  }

  onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
    this.pointerDown = {
      x: e.clientX,
      y: e.clientY,
      time: performance.now(),
      pointerId: e.pointerId,
      moved: false,
    };
  }

  onPointerMove(e) {
    if (this.pointerDown && this.pointerDown.pointerId === e.pointerId) {
      const dx = e.clientX - this.pointerDown.x;
      const dy = e.clientY - this.pointerDown.y;
      if (dx * dx + dy * dy > 70) this.pointerDown.moved = true;
    } else if (e.pointerType === "mouse") {
      this.hoverTest(e);
    }
  }

  onPointerUp(e) {
    if (!this.pointerDown) return;
    const wasTap = !this.pointerDown.moved && performance.now() - this.pointerDown.time < 620;
    const pointerId = this.pointerDown.pointerId;
    this.pointerDown = null;
    if (!wasTap || pointerId !== e.pointerId) return;
    const hit = this.pick(e.clientX, e.clientY);
    if (hit) this.select(hit);
    else this.deselect();
  }

  hoverTest(e) {
    const hit = this.pick(e.clientX, e.clientY);
    const id = hit?.id || null;
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.renderer.domElement.style.cursor = id ? "pointer" : "grab";
    }
  }

  pick(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const meshes = this.bodies.filter((b) => !b.isStar).map((b) => b.mesh || b.starMesh);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    if (hit) return this.bodies.find((b) => b.mesh === hit.object) || null;
    const starHit = this.raycaster.intersectObject(this.starMesh, false)[0];
    if (starHit) return this.star;
    return null;
  }

  select(bodyOrId) {
    const body = typeof bodyOrId === "string"
      ? this.bodies.find((b) => b.id === bodyOrId)
      : bodyOrId;
    if (!body) return;
    this.selectedId = body.id;
    this.updateSelectionOrbit(body);
    this.callbacks.onSelect?.(this.getBodyInfo(body));
  }

  deselect() {
    if (!this.selectedId) return;
    this.selectedId = null;
    this.selectionOrbit.visible = false;
    this.reticle.visible = false;
    this.callbacks.onSelect?.(null);
  }

  updateSelectionOrbit(body) {
    if (body.isStar) {
      this.selectionOrbit.visible = false;
      if (this.reticle) this.reticle.visible = false;
      return;
    }
    const radius = Math.sqrt(body.pos.x * body.pos.x + body.pos.z * body.pos.z);
    this.selectionOrbit.scale.setScalar(Math.max(radius, 0.01));
    this.selectionOrbit.visible = true;
    this.selectionOrbit.material.opacity = 0.42;
    if (this.reticle) {
      this.reticle.visible = true;
      this.reticle.position.copy(body.pos);
    }
  }

  ensureReticle() {
    if (this.reticle) return;
    const mat = new THREE.SpriteMaterial({
      map: getReticleTexture(),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      color: 0xffd39a,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
    });
    this.reticle = new THREE.Sprite(mat);
    this.reticle.renderOrder = 20;
    this.reticle.visible = false;
    this.scene.add(this.reticle);
  }

  fitSystem(immediate = false) {
    const aspect = Math.max(0.3, this.camera.aspect || window.innerWidth / window.innerHeight);
    const fitRadius = aspect < 0.75 ? 27 : 45.5;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const dist = Math.max(fitRadius / Math.tan(vFov / 2), fitRadius / Math.tan(hFov / 2)) * 1.07;
    const offset = new THREE.Vector3(0, 0.63, 1).normalize().multiplyScalar(clamp(dist, 48, 185));
    if (immediate) {
      this.camera.position.copy(offset);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
      return;
    }
    this.cameraGoal = offset;
    this.focusId = null;
    this.focusState = null;
    this.controls.target.set(0, 0, 0);
  }

  addWorld(type, radius, angle = null, forcedName = null) {
    const def = BODY_TYPES[type] || BODY_TYPES.terra;
    const chosenAngle = angle !== null ? angle : this.findClearAngle(radius);
    const name = forcedName || this.nextWorldName();
    const body = this.createBody({
      type,
      radius: def.radius,
      mass: def.mass,
      name,
      pos: orbitPosition(radius, chosenAngle),
      vel: circularVelocity(radius, chosenAngle, STAR_MASS),
      isMoon: false,
    });
    body.orbitRadius = radius;
    body.angle = chosenAngle;
    this.bodies.push(body);
    this.worlds.push(body);
    this.usedNames.add(name);
    if (!this.suppressEvents) this.callbacks.onEvent?.({ kind: "deploy", body });
    return body;
  }

  findClearAngle(radius) {
    let best = Math.random() * TAU;
    let bestScore = -Infinity;
    for (let i = 0; i < 36; i++) {
      const angle = Math.random() * TAU;
      let score = Infinity;
      for (const body of this.worlds) {
        if (!body.alive) continue;
        const currentAngle = Math.atan2(body.pos.z, body.pos.x);
        const d = Math.abs(body.orbitRadius - radius);
        if (d < 9) {
          const diff = Math.abs(Math.atan2(Math.sin(angle - currentAngle), Math.cos(angle - currentAngle)));
          score = Math.min(score, diff);
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = angle;
      }
      if (score === Infinity) break;
    }
    if (bestScore !== Infinity && bestScore < 0.22) {
      best = bestAngleAway(this.worlds, radius, radius);
    }
    return best;
  }

  nextWorldName() {
    for (const name of WORLD_NAMES) if (!this.usedNames.has(name)) return name;
    return `Kepler-${Math.floor(100 + Math.random() * 899)}`;
  }

  nextMoonName() {
    for (const name of MOON_NAMES) if (!this.usedMoonNames.has(name)) {
      this.usedMoonNames.add(name);
      return name;
    }
    return `M-${Math.floor(10 + Math.random() * 89)}`;
  }

  nextCometName() {
    for (const name of COMET_NAMES) if (!this.usedCometNames.has(name)) {
      this.usedCometNames.add(name);
      return name;
    }
    return `C/${Math.floor(100 + Math.random() * 899)}`;
  }

  createBody({ type, radius, mass, name, pos, vel, isMoon = false, parent = null, isComet = false }) {
    const def = BODY_TYPES[type];
    const group = new THREE.Group();
    const surfaceKey = isComet ? "ice" : isMoon ? "moon" : type;
    const surface = getSurface(surfaceKey);
    const material = new THREE.MeshStandardMaterial({
      map: surface.map,
      bumpMap: surface.bump,
      bumpScale: def.kind === "gas" ? 0.012 : 0.045,
      roughness: def.kind === "gas" ? 0.92 : 0.84,
      metalness: 0.015,
      color: 0xffffff,
      emissive: new THREE.Color(def.color),
      emissiveMap: surface.map,
      emissiveIntensity: 0.026,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), material);
    mesh.scale.setScalar(radius);
    group.add(mesh);

    let clouds = null;
    if (def.clouds) {
      const cloudMat = new THREE.MeshBasicMaterial({
        map: getCloudTexture(),
        transparent: true,
        opacity: type === "terra" ? 0.36 : 0.5,
        depthWrite: false,
        blending: THREE.NormalBlending,
      });
      clouds = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), cloudMat);
      clouds.scale.setScalar(radius * 1.014);
      group.add(clouds);
    }

    let atmosphere = null;
    if (def.atmosphere && !isComet) {
      const atmoMat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(def.atmosphere) },
          uStrength: { value: def.atmosphereStrength },
        },
        vertexShader: atmosphereVertex,
        fragmentShader: atmosphereFragment,
        transparent: true,
        side: THREE.BackSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 26), atmoMat);
      atmosphere.scale.setScalar(radius * 1.065);
      group.add(atmosphere);
    }

    let rings = null;
    if (def.ringed) {
      const ringGeo = new THREE.RingGeometry(radius * 1.48, radius * 2.48, 128, 1);
      const ringMat = new THREE.MeshBasicMaterial({
        map: getRingTexture(),
        color: 0xe2c49a,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      rings = new THREE.Mesh(ringGeo, ringMat);
      rings.rotation.x = -Math.PI / 2 + 0.22;
      rings.rotation.z = 0.12;
      group.add(rings);
    }

    let glow = null;
    if (isComet) {
      glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: getMiniGlowTexture(),
          color: 0xb9f4ff,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      glow.scale.setScalar(radius * 6.5);
      group.add(glow);
    } else if (def.kind === "gas" || type === "ice" || type === "terra") {
      glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: getGlowTexture(),
          color: new THREE.Color(def.atmosphere || def.color),
          transparent: true,
          opacity: type === "gas" ? 0.09 : 0.12,
          depthWrite: false,
          depthTest: false,
          blending: THREE.AdditiveBlending,
        })
      );
      glow.scale.setScalar(radius * 4.6);
      group.add(glow);
    }

    group.position.copy(pos);
    this.scene.add(group);

    const body = {
      id: isComet ? `comet-${++this.bodyCounter}` : isMoon ? `moon-${++this.bodyCounter}` : `world-${++this.bodyCounter}`,
      name,
      type,
      def,
      className: def.className,
      radius,
      mass,
      isMoon,
      isComet,
      isStar: false,
      parent,
      parentId: parent ? parent.id : null,
      group,
      mesh,
      clouds,
      atmosphere,
      rings,
      glow,
      material,
      pos: pos.clone(),
      vel: vel.clone(),
      spin: (isMoon ? 0.18 : isComet ? 0.5 : 0.12 + Math.random() * 0.22) * (Math.random() > 0.5 ? 1 : -1),
      tilt: (Math.random() - 0.5) * 0.7,
      alive: true,
      appear: 0,
      trail: [],
      trailClock: 0,
    };
    mesh.userData.bodyId = body.id;
    mesh.rotation.z = body.tilt;

    const trailGeo = new THREE.BufferGeometry();
    const maxTrail = isComet ? 70 : 80;
    trailGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(maxTrail * 3), 3));
    trailGeo.setDrawRange(0, 0);
    const trailMat = new THREE.LineBasicMaterial({
      color: isComet ? 0xb7efff : def.color,
      transparent: true,
      opacity: isComet ? 0.6 : isMoon ? 0.14 : 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const trailLine = new THREE.Line(trailGeo, trailMat);
    trailLine.frustumCulled = false;
    body.trailLine = trailLine;
    body.maxTrail = maxTrail;
    this.scene.add(trailLine);

    if (isComet) {
      this.comets.push(body);
    } else if (isMoon) {
      this.moons.push(body);
    }
    return body;
  }

  spawnMoon(parent, distance = null, angle = Math.random() * TAU, forcedName = null) {
    if (!parent || parent.isStar) return null;
    const def = BODY_TYPES.moon;
    const orbitDistance = distance || parent.radius * 1.55 + 1.2;
    const name = forcedName || this.nextMoonName();
    const pos = parent.pos.clone().add(orbitPosition(orbitDistance, angle, 0.02));
    const speed = Math.sqrt((G * parent.mass) / orbitDistance);
    const vel = parent.vel.clone().add(tangent(angle).multiplyScalar(speed));
    const moon = this.createBody({
      type: "moon",
      radius: def.radius,
      mass: def.mass,
      name,
      pos,
      vel,
      isMoon: true,
      parent,
    });
    moon.orbitDistance = orbitDistance;
    moon.angle = angle;
    this.bodies.push(moon);
    this.usedMoonNames.add(name);
    moon.railDistance = orbitDistance;
    moon.railAngle = angle;
    moon.railSpeed = speed / orbitDistance;
    if (!this.suppressEvents) this.callbacks.onEvent?.({ kind: "moon", body: moon, parent });
    return moon;
  }

  launchComet(target = null) {
    const selected = target || this.bodies.find((b) => b.id === this.selectedId);
    const targetBody = selected && !selected.isStar ? selected : null;
    const name = this.nextCometName();
    let pos;
    let vel;
    if (targetBody) {
      const outward = targetBody.pos.clone().normalize();
      const side = new THREE.Vector3(-outward.z, 0, outward.x);
      pos = targetBody.pos.clone()
        .add(outward.multiplyScalar(12.8))
        .add(side.multiplyScalar((Math.random() - 0.5) * 5.2));
      const flight = 2.2;
      const gravity = targetBody.pos.clone().multiplyScalar(-(G * STAR_MASS) / Math.pow(targetBody.pos.length(), 3));
      const predicted = targetBody.pos.clone()
        .add(targetBody.vel.clone().multiplyScalar(flight))
        .add(gravity.multiplyScalar(0.5 * flight * flight));
      vel = predicted.sub(pos).divideScalar(flight);
      vel.addScaledVector(targetBody.vel, 0.1);
    } else {
      const angle = Math.random() * TAU;
      const radius = 54 + Math.random() * 6;
      pos = orbitPosition(radius, angle, (Math.random() - 0.5) * 4);
      vel = circularVelocity(radius, angle, STAR_MASS).multiplyScalar(0.56);
      vel.multiplyScalar(0.72);
    }
    const comet = this.createBody({
      type: "comet",
      radius: BODY_TYPES.comet.radius,
      mass: BODY_TYPES.comet.mass,
      name,
      pos,
      vel,
      isComet: true,
    });
    comet.life = 0;
    this.bodies.push(comet);
    this.callbacks.onEvent?.({ kind: "comet", body: comet, target: targetBody });
    return comet;
  }

  addMoonToSelected() {
    const parent = this.bodies.find((b) => b.id === this.selectedId && !b.isStar && !b.isMoon && !b.isComet);
    if (!parent) return null;
    return this.spawnMoon(parent);
  }

  boostSelected(factor = 1) {
    const body = this.bodies.find((b) => b.id === this.selectedId && !b.isStar);
    if (!body) return null;
    const radial = body.pos.clone().setY(0).normalize();
    const prograde = new THREE.Vector3(-radial.z, 0, radial.x);
    body.vel.addScaledVector(prograde, 0.42 * factor);
    this.callbacks.onEvent?.({ kind: "boost", body });
    return body;
  }

  removeBody(body, options = {}) {
    if (!body || body.isStar || !body.alive) return;
    body.alive = false;
    if (body.id === this.selectedId) this.deselect();
    if (body.id === this.focusId) {
      this.focusId = null;
      this.focusState = null;
      this.controls.target.set(0, 0, 0);
    }
    this.scene.remove(body.group);
    this.scene.remove(body.trailLine);
    body.trailLine.geometry.dispose();
    body.trailLine.material.dispose();
    if (body.mesh.material) body.mesh.material.dispose();
    if (body.clouds) body.clouds.material.dispose();
    if (body.atmosphere) body.atmosphere.material.dispose();
    if (body.rings) body.rings.material.dispose();
    const children = this.bodies.filter((b) => b.parent === body);
    this.bodies = this.bodies.filter((b) => b !== body);
    this.worlds = this.worlds.filter((b) => b !== body);
    this.moons = this.moons.filter((b) => b !== body);
    this.comets = this.comets.filter((b) => b !== body);
    for (const child of children) this.removeBody(child, { silent: true });
    this.callbacks.onEvent?.({ kind: "remove", body, silent: options.silent });
  }

  deleteSelected() {
    const body = this.bodies.find((b) => b.id === this.selectedId);
    if (!body || body.isStar) return null;
    const pos = body.pos.clone();
    const color = new THREE.Color(body.def.color);
    this.removeBody(body);
    this.burst(pos, color, 0.8, 30);
    return body;
  }

  setGhost(type, radius) {
    if (!this.ghostGroup) return;
    const def = BODY_TYPES[type];
    const surfaceKey = type === "gas" ? "gas" : type;
    const surface = getSurface(surfaceKey);
    this.ghostMaterial.map = surface.map;
    this.ghostMaterial.color.set(0xffffff);
    this.ghostMaterial.opacity = 0.52;
    this.ghostMaterial.needsUpdate = true;
    this.ghostMesh.scale.setScalar(def.radius * 0.96);
    const angle = -0.72;
    this.ghostMesh.position.copy(orbitPosition(radius, angle, 0.02));
    this.ghostHalo.position.copy(this.ghostMesh.position);
    this.ghostHalo.scale.setScalar(def.radius * 4.4);
    this.ghostHalo.material.color.set(def.atmosphere || def.color);
    if (def.ringed) {
      if (!this.ghostRings) {
        this.ghostRings = new THREE.Mesh(
          new THREE.RingGeometry(1.48, 2.48, 96),
          new THREE.MeshBasicMaterial({
            map: getRingTexture(),
            transparent: true,
            opacity: 0.5,
            side: THREE.DoubleSide,
            depthWrite: false,
          })
        );
        this.ghostRings.rotation.x = -Math.PI / 2 + 0.22;
        this.ghostGroup.add(this.ghostRings);
      }
      this.ghostRings.visible = true;
      this.ghostRings.position.copy(this.ghostMesh.position);
      this.ghostRings.scale.setScalar(def.radius);
    } else if (this.ghostRings) {
      this.ghostRings.visible = false;
    }
    this.ghostOrbit.scale.setScalar(radius);
    this.ghostGroup.visible = true;
    this.habitableBand.material.opacity = 0.07;
    this.habitableEdges.forEach((e) => (e.material.opacity = 0.28));
  }

  hideGhost() {
    if (!this.ghostGroup) return;
    this.ghostGroup.visible = false;
    this.habitableBand.material.opacity = 0.026;
    this.habitableEdges.forEach((e) => (e.material.opacity = 0.16));
  }

  focusBody(bodyOrId = null) {
    const body = typeof bodyOrId === "string"
      ? this.bodies.find((b) => b.id === bodyOrId)
      : bodyOrId || this.bodies.find((b) => b.id === this.selectedId);
    if (!body) return;
    this.focusId = body.id;
    this.focusState = {
      started: performance.now(),
      startOffset: this.camera.position.clone().sub(body.pos),
      targetDistance: body.isStar ? 25 : Math.max(9, body.radius * 5.4 + 6.4),
      dir: this.camera.position.clone().sub(body.pos).normalize(),
    };
    this.controls.target.copy(body.pos);
    this.callbacks.onFocus?.(this.getBodyInfo(body));
  }

  exitFocus() {
    this.focusId = null;
    this.focusState = null;
    this.controls.target.set(0, 0, 0);
    this.fitSystem(false);
  }

  setPaused(paused) {
    this.paused = paused;
  }

  setTimeScale(scale) {
    this.timeScale = scale;
    this.paused = false;
  }

  updatePhysics(dt) {
    const steps = Math.min(4, Math.max(1, Math.ceil(dt / 0.016)));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (const moon of this.moons) {
        if (!moon.alive || !moon.parent || !moon.parent.alive) continue;
        moon.railAngle += moon.railSpeed * h;
        moon.pos.copy(moon.parent.pos).add(orbitPosition(moon.railDistance, moon.railAngle, 0.02));
        moon.vel.copy(moon.parent.vel).add(tangent(moon.railAngle).multiplyScalar(moon.railSpeed * moon.railDistance));
      }
      const active = this.bodies.filter((b) => !b.isStar && !b.isMoon);
      for (const body of active) {
        const r2 = body.pos.lengthSq() + 0.8;
        const r = Math.sqrt(r2);
        const accel = body.pos.clone().multiplyScalar(-(G * STAR_MASS) / (r2 * r));
        for (const other of active) {
          if (other === body) continue;
          const dx = other.pos.x - body.pos.x;
          const dy = other.pos.y - body.pos.y;
          const dz = other.pos.z - body.pos.z;
          const d2 = dx * dx + dy * dy + dz * dz + 0.12;
          if (d2 > 900) continue;
          const inv = (G * other.mass * PLANET_GRAVITY_SCALE) / (d2 * Math.sqrt(d2));
          accel.x += dx * inv;
          accel.y += dy * inv;
          accel.z += dz * inv;
        }
        body.vel.addScaledVector(accel, h);
        body.pos.addScaledVector(body.vel, h);
      }
      this.resolveCollisions();
    }
  }

  resolveCollisions() {
    const candidates = this.bodies.filter((b) => !b.isStar && b.alive);
    for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i];
      if (!a.alive) continue;
      const starDist = a.pos.length();
      if (starDist < STAR_RADIUS + a.radius * 0.55) {
        const pos = a.pos.clone();
        this.removeBody(a);
        this.burst(pos, new THREE.Color(0xffb36b), 2.8, 55, true);
        this.shake = Math.max(this.shake, 0.8);
        this.callbacks.onEvent?.({ kind: "star", body: a });
        continue;
      }
      for (let j = i + 1; j < candidates.length; j++) {
        const b = candidates[j];
        if (!b.alive || !a.alive) continue;
        // Moons are held on a stable parent-relative orbit for readable, game-like motion.
        // They can still be struck by comets, but do not destructively graze other worlds.
        if ((a.isMoon && !b.isComet) || (b.isMoon && !a.isComet)) continue;
        const minDist = (a.radius + b.radius) * 0.76;
        if (a.pos.distanceToSquared(b.pos) < minDist * minDist) {
          this.mergeBodies(a, b);
        }
      }
    }
  }

  mergeBodies(a, b) {
    if (!a.alive || !b.alive) return;
    const heavy = a.mass >= b.mass ? a : b;
    const light = heavy === a ? b : a;
    const impact = heavy.pos.clone().add(light.pos).multiplyScalar(0.5);
    const totalMass = heavy.mass + light.mass;
    const newPos = heavy.pos.clone().multiplyScalar(heavy.mass).add(light.pos.clone().multiplyScalar(light.mass)).divideScalar(totalMass);
    const newVel = heavy.vel.clone().multiplyScalar(heavy.mass).add(light.vel.clone().multiplyScalar(light.mass)).divideScalar(totalMass);
    heavy.pos.copy(newPos);
    heavy.vel.copy(newVel);
    heavy.mass = totalMass;
    heavy.radius = Math.cbrt(Math.pow(a.radius, 3) + Math.pow(b.radius, 3));
    heavy.mesh.scale.setScalar(heavy.radius);
    if (heavy.clouds) heavy.clouds.scale.setScalar(heavy.radius * 1.014);
    if (heavy.atmosphere) heavy.atmosphere.scale.setScalar(heavy.radius * 1.065);
    if (heavy.rings) heavy.rings.scale.setScalar(heavy.radius / (heavy.def.radius || heavy.radius));
    if (heavy.glow) heavy.glow.scale.setScalar(heavy.radius * (heavy.isComet ? 6.5 : 4.6));
    heavy.group.position.copy(newPos);
    const color = new THREE.Color(light.def.color).lerp(new THREE.Color(heavy.def.color), 0.35);
    this.removeBody(light, { silent: true });
    this.burst(impact, color, 1.6 + Math.min(1.2, totalMass * 0.04), 46);
    this.shake = Math.max(this.shake, 0.55);
    this.callbacks.onEvent?.({
      kind: "collision",
      a: heavy,
      b: light,
      pos: impact,
      heavy,
    });
  }

  burst(pos, color, scale = 1, count = 40, star = false) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = [];
    const baseColor = color.clone();
    for (let i = 0; i < count; i++) {
      positions[i * 3] = pos.x;
      positions[i * 3 + 1] = pos.y;
      positions[i * 3 + 2] = pos.z;
      const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      const speed = (0.35 + Math.random() * 1.35) * scale * (star ? 1.8 : 1);
      velocities.push(dir.multiplyScalar(speed));
      const c = baseColor.clone().lerp(new THREE.Color(0xffe8c1), Math.random() * 0.6);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      map: getMiniGlowTexture(),
      size: 0.52 * (star ? 1.6 : 1),
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.scene.add(points);
    this.particles.push({ points, velocities, life: 0, max: star ? 1.8 : 1.25 });

    const flash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: star ? 0xffb268 : baseColor,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      })
    );
    flash.position.copy(pos);
    flash.scale.setScalar(scale * (star ? 8 : 3.5));
    this.scene.add(flash);
    this.particles.push({ sprite: flash, life: 0, max: 0.72, startScale: scale * (star ? 8 : 3.5) });
  }

  updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      const t = p.life / p.max;
      if (t >= 1) {
        if (p.points) {
          this.scene.remove(p.points);
          p.points.geometry.dispose();
          p.points.material.dispose();
        }
        if (p.sprite) {
          this.scene.remove(p.sprite);
          p.sprite.material.dispose();
        }
        this.particles.splice(i, 1);
        continue;
      }
      if (p.points) {
        const attr = p.points.geometry.attributes.position;
        for (let j = 0; j < p.velocities.length; j++) {
          const v = p.velocities[j];
          attr.array[j * 3] += v.x * dt;
          attr.array[j * 3 + 1] += v.y * dt;
          attr.array[j * 3 + 2] += v.z * dt;
          v.multiplyScalar(0.985);
        }
        attr.needsUpdate = true;
        p.points.material.opacity = Math.pow(1 - t, 1.8);
      }
      if (p.sprite) {
        p.sprite.material.opacity = Math.pow(1 - t, 2.2) * 0.9;
        p.sprite.scale.setScalar(p.startScale * (1 + t * 2.4));
      }
    }
  }

  updateTrails(dt) {
    this.trailClock += dt;
    if (this.trailClock < 0.07) return;
    this.trailClock = 0;
    for (const body of this.bodies) {
      if (body.isStar || !body.alive) continue;
      body.trailClock += 0.07;
      if (body.trailClock < 0.1) continue;
      body.trailClock = 0;
      body.trail.push(body.pos.clone());
      if (body.trail.length > body.maxTrail) body.trail.shift();
      const attr = body.trailLine.geometry.attributes.position;
      const n = body.trail.length;
      for (let i = 0; i < n; i++) {
        attr.array[i * 3] = body.trail[i].x;
        attr.array[i * 3 + 1] = body.trail[i].y;
        attr.array[i * 3 + 2] = body.trail[i].z;
      }
      attr.needsUpdate = true;
      body.trailLine.geometry.setDrawRange(0, n);
    }
  }

  updateBodies(dt) {
    for (const body of this.bodies) {
      if (body.isStar) continue;
      body.group.position.copy(body.pos);
      if (body.appear < 1) body.appear = Math.min(1, body.appear + dt * 1.7);
      const a = easeOutCubic(body.appear);
      body.group.scale.setScalar(0.28 + a * 0.72);
      body.mesh.rotation.y += body.spin * dt;
      if (body.clouds) body.clouds.rotation.y += body.spin * dt * 1.2;
      if (body.isComet && body.glow) {
        body.glow.material.opacity = 0.65 + Math.sin(this.realTime * 7 + body.pos.x) * 0.18;
      }
      if (body.isComet) {
        body.life = (body.life || 0) + dt;
        if (body.life > 65) this.removeBody(body, { silent: true });
      }
    }
    if (this.reticle) {
      const selected = this.bodies.find((b) => b.id === this.selectedId);
      if (selected && !selected.isStar) {
        this.reticle.visible = true;
        this.reticle.position.copy(selected.pos);
        const s = selected.radius * (5.2 + Math.sin(this.realTime * 2.4) * 0.2);
        this.reticle.scale.setScalar(s);
        this.selectionOrbit.position.y = 0;
        const r = Math.sqrt(selected.pos.x ** 2 + selected.pos.z ** 2);
        this.selectionOrbit.scale.setScalar(Math.max(r, 0.01));
        this.selectionOrbit.material.opacity = 0.4 + Math.sin(this.realTime * 1.6) * 0.12;
      } else {
        this.reticle.visible = false;
      }
    }
  }

  updateBelt(dt) {
    if (!this.belt) return;
    for (let i = 0; i < this.beltRocks.length; i++) {
      const rock = this.beltRocks[i];
      rock.angle += rock.speed * dt;
      this.beltDummy.position.set(Math.cos(rock.angle) * rock.radius, rock.y, Math.sin(rock.angle) * rock.radius);
      this.beltDummy.rotation.y += dt * 0.2;
      this.beltDummy.scale.setScalar(rock.size);
      this.beltDummy.updateMatrix();
      this.belt.setMatrixAt(i, this.beltDummy.matrix);
    }
    this.belt.instanceMatrix.needsUpdate = true;
  }

  updateCamera(dt) {
    const now = performance.now();
    if (this.cameraGoal) {
      const k = 1 - Math.pow(0.0015, dt);
      this.camera.position.lerp(this.cameraGoal, k);
      if (this.camera.position.distanceTo(this.cameraGoal) < 0.25) this.cameraGoal = null;
    }
    if (this.focusId) {
      const body = this.bodies.find((b) => b.id === this.focusId);
      if (!body) {
        this.focusId = null;
        this.focusState = null;
      } else if (this.focusState) {
        const elapsed = (now - this.focusState.started) / 1000;
        if (elapsed < 1.25) {
          const t = easeOutCubic(Math.min(1, elapsed / 1.25));
          const dir = this.camera.position.clone().sub(this.controls.target);
          const currentDistance = dir.length();
          const wanted = THREE.MathUtils.lerp(this.focusState.startOffset.length(), this.focusState.targetDistance, t);
          dir.normalize().multiplyScalar(wanted);
          this.camera.position.copy(body.pos).add(dir);
          this.controls.target.copy(body.pos);
        } else {
          const delta = body.pos.clone().sub(this.controls.target);
          this.camera.position.add(delta);
          this.controls.target.copy(body.pos);
          this.focusState = null;
        }
      } else {
        const delta = body.pos.clone().sub(this.controls.target);
        this.camera.position.add(delta);
        this.controls.target.copy(body.pos);
      }
    }
    this.controls.update();
    if (this.shake > 0.002) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.3;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.3;
      this.camera.position.z += (Math.random() - 0.5) * this.shake * 0.3;
      this.shake *= Math.pow(0.002, dt);
    }
  }

  tick() {
    const frameDt = this.clock.getDelta();
    const rawDt = Math.min(0.1, frameDt);
    this.adaptQuality(Math.min(frameDt, 0.5));
    this.realTime += rawDt;
    const simScale = this.paused ? 0 : this.timeScale;
    const dt = rawDt * simScale;
    if (dt > 0) {
      this.simTime += dt;
      this.updatePhysics(dt);
      this.updateBelt(dt);
      this.updateTrails(dt);
    }
    this.updateBodies(dt || rawDt * 0.15);
    this.updateParticles(rawDt);
    this.updateCamera(rawDt);
    this.starMaterial.uniforms.uTime.value = this.realTime;
    this.starArcs.rotation.y = this.realTime * 0.018;
    this.starArcs.rotation.x = Math.sin(this.realTime * 0.06) * 0.12;
    this.starGlows.forEach((g, i) => {
      const pulse = 1 + Math.sin(this.realTime * (0.55 + i * 0.08) + g.phase) * 0.025;
      g.sprite.scale.setScalar(g.baseScale * pulse);
      g.sprite.material.opacity = g.baseOpacity * (0.9 + Math.sin(this.realTime * 0.7 + g.phase) * 0.1);
    });
    this.starfield.rotation.y += rawDt * 0.0016;
    this.brightStars.rotation.y += rawDt * 0.001;
    this.snapshotClock += rawDt;
    if (this.snapshotClock > 0.08 && this.callbacks.onFrame) {
      this.snapshotClock = 0;
      this.callbacks.onFrame(this.getSnapshot());
    }
    this.composer.render();
  }

  resize() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    if (!width || !height) return;
    const aspect = width / height;
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 0.75 ? 50 : 42;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    if (this.composer) {
      this.composer.setSize(width, height);
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.bloom.setSize(width, height);
    }
  }

  project(vec) {
    const p = vec.clone().project(this.camera);
    return {
      x: (p.x * 0.5 + 0.5) * this.container.clientWidth,
      y: (-p.y * 0.5 + 0.5) * this.container.clientHeight,
      visible: p.z > -1 && p.z < 1,
      depth: p.z,
    };
  }

  getBodyInfo(body) {
    if (!body) return null;
    if (body.isStar) {
      return {
        id: body.id,
        name: body.name,
        className: "G2V MAIN SEQUENCE",
        kind: "star",
        isStar: true,
        orbit: "SYSTEM CENTER",
        mass: "1.00 M☉",
        velocity: "—",
        period: "—",
        selected: true,
      };
    }
    const orbit = Math.sqrt(body.pos.x ** 2 + body.pos.z ** 2);
    const speed = body.vel.length();
    const period = orbit > 0 ? (TAU * orbit) / Math.max(0.2, speed) : 0;
    return {
      id: body.id,
      name: body.name,
      className: body.className,
      color: body.def.color,
      kind: body.def.kind,
      isStar: false,
      isMoon: body.isMoon,
      isComet: body.isComet,
      orbit: body.isMoon && body.parent ? `${(body.pos.distanceTo(body.parent.pos) / 8.2).toFixed(2)} AU` : `${(orbit / 8.2).toFixed(2)} AU`,
      mass: `${(body.mass * 0.68).toFixed(body.mass < 1 ? 2 : 1)} M⊕`,
      velocity: `${(speed * 0.72).toFixed(1)} km/s`,
      period: `${(period * 1.15).toFixed(1)} d`,
      radius: body.radius,
    };
  }

  getSnapshot() {
    const worlds = this.worlds.filter((b) => b.alive);
    const moons = this.moons.filter((b) => b.alive);
    let stabilitySum = 0;
    for (const w of worlds) {
      const r = w.pos.length();
      const circular = Math.sqrt((G * STAR_MASS) / Math.max(r, 0.1));
      const tangential = new THREE.Vector3(-w.pos.z, 0, w.pos.x).normalize().dot(w.vel);
      const error = Math.abs(tangential / circular - 1);
      stabilitySum += clamp(1 - error * 1.3, 0, 1);
    }
    const stability = worlds.length ? Math.round((stabilitySum / worlds.length) * 100) : 100;
    const bodies = this.bodies.map((b) => ({
      id: b.id,
      name: b.name,
      radius: b.radius,
      color: b.def?.color || "#e7bd7d",
      isStar: b.isStar,
      isMoon: b.isMoon,
      isComet: b.isComet,
      className: b.className,
      screen: this.project(b.pos),
    }));
    return {
      simTime: this.simTime,
      worlds: worlds.length,
      moons: moons.length,
      comets: this.comets.length,
      stability,
      bodies,
      habitable: this.project(this.habitableAnchor),
      selected: this.getBodyInfo(this.bodies.find((b) => b.id === this.selectedId)),
      paused: this.paused,
      timeScale: this.timeScale,
      focusId: this.focusId,
    };
  }

  getBodyList() {
    return this.bodies;
  }
}

function bestAngleAway(worlds, radius, fallbackRadius) {
  let best = 0;
  let bestDistance = -1;
  for (let i = 0; i < 24; i++) {
    const angle = (i / 24) * TAU;
    let min = Infinity;
    for (const w of worlds) {
      if (Math.abs(w.orbitRadius - fallbackRadius) > 9) continue;
      const wAngle = Math.atan2(w.pos.z, w.pos.x);
      const d = Math.abs(Math.atan2(Math.sin(angle - wAngle), Math.cos(angle - wAngle)));
      min = Math.min(min, d);
    }
    if (min > bestDistance) {
      bestDistance = min;
      best = angle;
    }
  }
  return best;
}
