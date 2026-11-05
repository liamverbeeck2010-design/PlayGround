import { CanvasTexture, LinearFilter, SRGBColorSpace } from "three";

const TAU = Math.PI * 2;

function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 69069);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

// Value noise with a wrap period on x so sphere maps do not show a seam.
function noise2(x, y, seed, period) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const x0 = ((ix % period) + period) % period;
  const x1 = ((ix + 1) % period + period) % period;
  const sy = smooth(fy);
  const a = hash2(x0, iy, seed);
  const b = hash2(x1, iy, seed);
  const c = hash2(x0, iy + 1, seed);
  const d = hash2(x1, iy + 1, seed);
  const top = a + (b - a) * smooth(fx);
  const bottom = c + (d - c) * smooth(fx);
  return top + (bottom - top) * sy;
}

function fbm(u, v, seed, octaves = 5, scale = 4) {
  let sum = 0;
  let amp = 0.5;
  let total = 0;
  let period = scale;
  let x = u * scale;
  let y = v * scale;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x, y, seed + i * 31, period) * amp;
    total += amp;
    x *= 2;
    y *= 2;
    period *= 2;
    amp *= 0.52;
  }
  return sum / total;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(a, b, v) {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function mix(a, b, t) {
  t = clamp01(t);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function makeCanvas(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function canvasTexture(canvas, target = SRGBColorSpace) {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = target;
  tex.wrapS = 1000;
  tex.wrapT = 1000;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function surfaceCanvas(w, h, painter) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const image = ctx.createImageData(w, h);
  const data = image.data;
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const c = painter(u, v, x, y);
      const i = (y * w + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return { canvas, ctx, image };
}

function addCraters(ctx, w, h, seed, count, options = {}) {
  const rand = mulberry(seed);
  const light = options.light || "rgba(255,244,220,.13)";
  const shadow = options.shadow || "rgba(0,0,0,.28)";
  for (let i = 0; i < count; i++) {
    const cx = rand() * w;
    const cy = h * (0.12 + rand() * 0.76);
    const r = (options.min || 2) + rand() * (options.max || 13);
    const stretch = 0.65 + rand() * 0.65;
    for (const wrap of [-w, 0, w]) {
      const x = cx + wrap;
      if (x < -r * 2 || x > w + r * 2) continue;
      const g = ctx.createRadialGradient(x - r * 0.28, cy - r * 0.28, r * 0.08, x, cy, r);
      g.addColorStop(0, shadow);
      g.addColorStop(0.55, "rgba(0,0,0,.08)");
      g.addColorStop(0.82, light);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.save();
      ctx.translate(x, cy);
      ctx.scale(1, 1 / stretch);
      ctx.translate(-x, -cy);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, cy, r, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
}

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawStorm(ctx, x, y, rx, ry, rotation, colors) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(-rx * 0.2, -rx * 0.15, rx * 0.04, 0, 0, rx);
  g.addColorStop(0, colors[0]);
  g.addColorStop(0.45, colors[1]);
  g.addColorStop(0.82, colors[2]);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function toneBump(canvas) {
  const out = makeCanvas(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2));
  const ctx = out.getContext("2d");
  ctx.filter = "grayscale(1) contrast(1.5) brightness(.9)";
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

function makeTerra(seed = 71) {
  const { canvas, ctx } = surfaceCanvas(512, 256, (u, v) => {
    const lat = Math.abs(v - 0.5) * 2;
    const broad = fbm(u, v, seed, 5, 4);
    const fine = fbm(u + 0.19, v - 0.23, seed + 88, 4, 13);
    const elev = broad * 0.73 + fine * 0.27;
    const polar = smoothstep(0.78, 0.94, lat + (fine - 0.5) * 0.16);
    const coast = smoothstep(0.49, 0.53, elev);

    let c;
    if (elev < 0.49) {
      const depth = smoothstep(0.18, 0.49, elev);
      c = mix([9, 42, 77], [24, 91, 128], depth);
      c = mix(c, [39, 130, 138], smoothstep(0.44, 0.5, elev) * 0.72);
    } else {
      const dry = fbm(u + 0.5, v, seed + 12, 3, 7);
      const green = [79, 121, 73];
      const olive = [144, 128, 78];
      const rock = [163, 156, 132];
      c = mix(green, olive, smoothstep(0.4, 0.72, dry));
      c = mix(c, rock, smoothstep(0.61, 0.69, elev));
      c = mix(c, [197, 199, 190], smoothstep(0.72, 0.83, elev + fine * 0.06));
      c = mix(c, [99, 82, 58], smoothstep(0.53, 0.61, 1 - fine) * 0.24);
    }
    c = mix(c, [226, 239, 242], polar * 0.95);
    const cloudShade = fbm(u + 0.7, v + 0.2, seed + 31, 3, 6);
    const brightness = 0.92 + cloudShade * 0.12;
    return [c[0] * brightness, c[1] * brightness, c[2] * brightness];
  });
  addCraters(ctx, 512, 256, seed + 9, 20, { min: 1.4, max: 7, light: "rgba(210,225,210,.09)", shadow: "rgba(0,18,22,.16)" });
  return { map: canvas, bump: toneBump(canvas) };
}

function makeOcean(seed = 24) {
  const { canvas } = surfaceCanvas(512, 256, (u, v) => {
    const lat = Math.abs(v - 0.5) * 2;
    const current = fbm(u, v, seed, 5, 3);
    const detail = fbm(u + 0.4, v + 0.15, seed + 20, 4, 9);
    const swirl = Math.sin((u * 12 + current * 5) * Math.PI) * 0.5 + 0.5;
    let c = mix([7, 36, 76], [17, 88, 128], current * 0.8 + swirl * 0.2);
    c = mix(c, [43, 158, 162], smoothstep(0.66, 0.78, detail) * 0.38);
    const island = smoothstep(0.75, 0.8, current + detail * 0.34 - 0.18);
    c = mix(c, [137, 146, 91], island);
    if (island > 0.6) c = mix(c, [92, 116, 80], 0.5);
    const polar = smoothstep(0.83, 0.95, lat + (detail - 0.5) * 0.1);
    c = mix(c, [221, 239, 243], polar);
    const shine = 0.9 + detail * 0.16;
    return [c[0] * shine, c[1] * shine, c[2] * shine];
  });
  return { map: canvas, bump: toneBump(canvas) };
}

function makeDesert(seed = 53) {
  const { canvas, ctx } = surfaceCanvas(512, 256, (u, v) => {
    const lat = Math.abs(v - 0.5) * 2;
    const dune = fbm(u, v, seed, 5, 5);
    const bands = Math.sin((v * 18 + dune * 2.4 + u * 1.1) * Math.PI) * 0.5 + 0.5;
    let c = mix([94, 50, 34], [184, 117, 70], bands * 0.45 + dune * 0.55);
    c = mix(c, [220, 160, 96], smoothstep(0.58, 0.82, dune) * 0.5);
    c = mix(c, [111, 61, 43], smoothstep(0.64, 0.79, 1 - bands) * 0.28);
    const polar = smoothstep(0.91, 1.0, lat);
    c = mix(c, [223, 215, 192], polar * 0.55);
    const grit = 0.9 + fbm(u + 0.2, v + 0.5, seed + 3, 3, 18) * 0.18;
    return [c[0] * grit, c[1] * grit, c[2] * grit];
  });
  addCraters(ctx, 512, 256, seed + 4, 25, { min: 1, max: 9, light: "rgba(255,222,166,.13)", shadow: "rgba(35,12,6,.22)" });
  return { map: canvas, bump: toneBump(canvas) };
}

function makeIce(seed = 98) {
  const { canvas, ctx } = surfaceCanvas(512, 256, (u, v) => {
    const n = fbm(u, v, seed, 5, 5);
    const n2 = fbm(u + 0.6, v - 0.2, seed + 17, 4, 11);
    let c = mix([108, 158, 181], [202, 231, 236], n * 0.7 + n2 * 0.3);
    c = mix(c, [238, 248, 247], smoothstep(0.6, 0.82, n2));
    c = mix(c, [83, 128, 161], smoothstep(0.52, 0.7, 1 - n) * 0.35);
    return c;
  });
  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  const rand = mulberry(seed + 3);
  for (let i = 0; i < 26; i++) {
    const x = rand() * 512;
    const y = 30 + rand() * 196;
    ctx.strokeStyle = `rgba(51,93,126,${0.1 + rand() * 0.18})`;
    ctx.lineWidth = 0.6 + rand() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    let xx = x;
    let yy = y;
    for (let s = 0; s < 4; s++) {
      xx += (rand() - 0.5) * 38;
      yy += (rand() - 0.5) * 22;
      ctx.lineTo(xx, yy);
    }
    ctx.stroke();
  }
  ctx.restore();
  addCraters(ctx, 512, 256, seed + 5, 14, { min: 1, max: 5, light: "rgba(255,255,255,.18)", shadow: "rgba(20,52,81,.2)" });
  return { map: canvas, bump: toneBump(canvas) };
}

function makeGas(seed = 12) {
  const palette = [
    [72, 46, 47],
    [151, 86, 63],
    [213, 151, 99],
    [241, 202, 150],
    [132, 106, 98],
    [190, 126, 85],
  ];
  const { canvas, ctx } = surfaceCanvas(512, 256, (u, v) => {
    const turbulence = fbm(u, v, seed, 5, 3);
    const fine = fbm(u + 0.3, v + 0.1, seed + 21, 4, 12);
    const band = Math.sin((v * 31 + turbulence * 2.7 + Math.sin(u * TAU * 2) * 0.18) * Math.PI) * 0.5 + 0.5;
    const band2 = Math.sin((v * 13 - turbulence * 2.1 + 0.4) * Math.PI) * 0.5 + 0.5;
    const idx = (band * 0.65 + band2 * 0.35) * (palette.length - 1);
    const i0 = Math.floor(idx);
    const i1 = Math.min(palette.length - 1, i0 + 1);
    let c = mix(palette[i0], palette[i1], idx - i0);
    c = mix(c, [245, 222, 182], smoothstep(0.62, 0.9, fine) * 0.2);
    c = mix(c, [89, 53, 49], smoothstep(0.58, 0.84, turbulence) * 0.18);
    const shade = 0.93 + fine * 0.13;
    return [c[0] * shade, c[1] * shade, c[2] * shade];
  });

  drawStorm(ctx, 358, 152, 62, 31, -0.13, [
    "rgba(230,162,103,.8)",
    "rgba(157,75,51,.62)",
    "rgba(78,45,45,.15)",
  ]);
  drawStorm(ctx, 125, 92, 37, 17, 0.2, [
    "rgba(255,223,174,.55)",
    "rgba(176,113,73,.46)",
    "rgba(80,48,39,.1)",
  ]);
  drawStorm(ctx, 436, 73, 24, 11, 0.1, [
    "rgba(242,194,137,.42)",
    "rgba(138,87,64,.3)",
    "rgba(70,45,39,.08)",
  ]);
  return { map: canvas, bump: null };
}

function makeMoonSurface(seed = 121) {
  const { canvas, ctx } = surfaceCanvas(256, 128, (u, v) => {
    const n = fbm(u, v, seed, 4, 5);
    const mare = smoothstep(0.54, 0.68, fbm(u + 0.3, v, seed + 8, 3, 3));
    let c = mix([86, 83, 79], [148, 143, 135], n);
    c = mix(c, [60, 59, 58], mare * 0.5);
    return c;
  });
  addCraters(ctx, 256, 128, seed + 3, 44, { min: 1, max: 11, light: "rgba(245,239,222,.18)", shadow: "rgba(0,0,0,.36)" });
  return { map: canvas, bump: toneBump(canvas) };
}

function makeClouds(seed = 35) {
  const canvas = makeCanvas(512, 256);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(512, 256);
  for (let y = 0; y < 256; y++) {
    const v = y / 255;
    for (let x = 0; x < 512; x++) {
      const u = x / 512;
      const band = fbm(u, v, seed, 5, 4);
      const wisp = fbm(u + 0.5, v - 0.1, seed + 22, 4, 15);
      const alpha = smoothstep(0.54, 0.73, band * 0.68 + wisp * 0.4) * 205;
      const i = (y * 512 + x) * 4;
      image.data[i] = 239;
      image.data[i + 1] = 243;
      image.data[i + 2] = 242;
      image.data[i + 3] = alpha;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function makeRingTexture(seed = 17) {
  const size = 512;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(size, size);
  const rand = mulberry(seed);
  const fine = Array.from({ length: 240 }, () => rand());
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - size / 2) / (size / 2);
      const dy = (y - size / 2) / (size / 2);
      const r = Math.sqrt(dx * dx + dy * dy);
      let alpha = 0;
      let tint = 0.8;
      if (r > 0.36 && r < 0.97) {
        const band = fine[Math.floor((r - 0.36) * 380) % fine.length];
        const gapA = r > 0.58 && r < 0.615;
        const gapB = r > 0.79 && r < 0.804;
        alpha = (0.18 + band * 0.62) * (1 - Math.abs(r - 0.66) * 0.3);
        alpha *= (gapA || gapB) ? 0.06 : 1;
        alpha *= smoothstep(0.36, 0.39, r) * (1 - smoothstep(0.93, 0.97, r));
        tint = 0.72 + band * 0.3;
      }
      const i = (y * size + x) * 4;
      image.data[i] = 222 * tint;
      image.data[i + 1] = 198 * tint;
      image.data[i + 2] = 156 * tint;
      image.data[i + 3] = alpha * 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function makeGlowTexture(size = 256, stops = null) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const use = stops || [
    [0, "rgba(255,252,239,1)"],
    [0.09, "rgba(255,234,187,.94)"],
    [0.23, "rgba(255,185,102,.42)"],
    [0.46, "rgba(250,117,43,.12)"],
    [0.72, "rgba(220,70,20,.025)"],
    [1, "rgba(0,0,0,0)"],
  ];
  for (const [p, c] of use) g.addColorStop(p, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

function makeReticleTexture(size = 256) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const c = size / 2;
  ctx.translate(c, c);
  ctx.strokeStyle = "rgba(255,211,146,.9)";
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.33, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,211,146,.36)";
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.4, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,211,146,.9)";
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const x = Math.cos(a) * size * 0.36;
    const y = Math.sin(a) * size * 0.36;
    ctx.beginPath();
    ctx.moveTo(x * 1.04, y * 1.04);
    ctx.lineTo(x * 1.2, y * 1.2);
    ctx.stroke();
  }
  return canvas;
}

function makePreview(canvas) {
  const size = 128;
  const out = makeCanvas(size, size);
  const ctx = out.getContext("2d");
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, TAU);
  ctx.clip();
  // Crop a square from the widest part of the equirectangular map.
  const s = canvas.height;
  ctx.drawImage(canvas, (canvas.width - s) / 2, 0, s, s, 0, 0, size, size);
  const shade = ctx.createRadialGradient(size * 0.34, size * 0.3, size * 0.1, size * 0.5, size * 0.52, size * 0.7);
  shade.addColorStop(0, "rgba(255,255,255,.08)");
  shade.addColorStop(0.5, "rgba(0,0,0,.08)");
  shade.addColorStop(1, "rgba(0,0,0,.56)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, size, size);
  return out.toDataURL("image/jpeg", 0.82);
}

const surfaceBuilders = {
  terra: makeTerra,
  ocean: makeOcean,
  desert: makeDesert,
  ice: makeIce,
  gas: makeGas,
  moon: makeMoonSurface,
};

const cache = {};
const shared = {};

export const BODY_TYPES = {
  terra: {
    label: "Terra",
    className: "TERRESTRIAL",
    kind: "terrestrial",
    radius: 1.85,
    mass: 2.4,
    color: "#7dc6b9",
    atmosphere: "#87d4d2",
    atmosphereStrength: 0.9,
    clouds: true,
    ringed: false,
    seed: 71,
  },
  ocean: {
    label: "Ocean",
    className: "OCEAN WORLD",
    kind: "terrestrial",
    radius: 2.0,
    mass: 2.9,
    color: "#4f9fd6",
    atmosphere: "#63b7e8",
    atmosphereStrength: 1.05,
    clouds: true,
    ringed: false,
    seed: 24,
  },
  desert: {
    label: "Desert",
    className: "DESERT WORLD",
    kind: "terrestrial",
    radius: 1.7,
    mass: 1.9,
    color: "#cf9260",
    atmosphere: "#e0a776",
    atmosphereStrength: 0.52,
    clouds: false,
    ringed: false,
    seed: 53,
  },
  ice: {
    label: "Ice",
    className: "ICE WORLD",
    kind: "terrestrial",
    radius: 1.62,
    mass: 1.4,
    color: "#b9e4ed",
    atmosphere: "#bcebf4",
    atmosphereStrength: 0.8,
    clouds: false,
    ringed: false,
    seed: 98,
  },
  gas: {
    label: "Jovian",
    className: "GAS GIANT",
    kind: "gas",
    radius: 3.75,
    mass: 17,
    color: "#e0b087",
    atmosphere: "#eac19a",
    atmosphereStrength: 0.62,
    clouds: false,
    ringed: true,
    seed: 12,
  },
  comet: {
    label: "Comet",
    className: "ICE BODY",
    kind: "comet",
    radius: 0.5,
    mass: 0.03,
    color: "#bdf4ff",
    atmosphere: "#a5efff",
    atmosphereStrength: 0.7,
    clouds: false,
    ringed: false,
    seed: 61,
  },
  moon: {
    label: "Moon",
    className: "NATURAL SATELLITE",
    kind: "moon",
    radius: 0.68,
    mass: 0.18,
    color: "#b7b1a4",
    atmosphere: null,
    atmosphereStrength: 0,
    clouds: false,
    ringed: false,
    seed: 121,
  },
};

export function getSurface(kind) {
  if (!surfaceBuilders[kind]) return getSurface("terra");
  if (!cache[kind]) {
    const built = surfaceBuilders[kind]();
    cache[kind] = {
      map: canvasTexture(built.map),
      bump: built.bump ? canvasTexture(toneBump(built.bump), "") : null,
      preview: makePreview(built.map),
    };
  }
  return cache[kind];
}

export function getCloudTexture() {
  if (!shared.clouds) shared.clouds = canvasTexture(makeClouds());
  return shared.clouds;
}

export function getRingTexture() {
  if (!shared.ring) {
    const tex = canvasTexture(makeRingTexture());
    tex.premultiplyAlpha = true;
    shared.ring = tex;
  }
  return shared.ring;
}

export function getGlowTexture() {
  if (!shared.glow) shared.glow = canvasTexture(makeGlowTexture());
  return shared.glow;
}

export function getReticleTexture() {
  if (!shared.reticle) shared.reticle = canvasTexture(makeReticleTexture());
  return shared.reticle;
}

export function getMiniGlowTexture() {
  if (!shared.miniGlow) {
    shared.miniGlow = canvasTexture(makeGlowTexture(128, [
      [0, "rgba(255,255,255,1)"],
      [0.25, "rgba(255,255,255,.45)"],
      [0.6, "rgba(255,255,255,.08)"],
      [1, "rgba(0,0,0,0)"],
    ]));
  }
  return shared.miniGlow;
}
