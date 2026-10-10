// Generates Aura's PNG app icons procedurally (no image dependencies):
// a luminous orb with a conic violet→cyan→magenta glow on midnight navy.
// Run with: node scripts/generate-icons.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
mkdirSync(out, { recursive: true });

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const mix = (a, b, t) => a + (b - a) * t;
const STOPS = [
  [0x55, 0xe7, 0xff],
  [0x9b, 0x7c, 0xff],
  [0xff, 0x79, 0xcf],
  [0x55, 0xe7, 0xff],
];

function color(angle) {
  const t = ((angle / (Math.PI * 2)) % 1 + 1) % 1;
  const seg = t * (STOPS.length - 1);
  const i = Math.floor(seg);
  const f = seg - i;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  return [mix(a[0], b[0], f), mix(a[1], b[1], f), mix(a[2], b[2], f)];
}

function render(size, { maskable }) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const cx = size / 2;
  const cy = size / 2;
  const orb = size * (maskable ? 0.24 : 0.3);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      let r = 8, g = 9, b = 20;
      // Soft outer halo.
      const halo = Math.exp(-((d / (orb * 1.9)) ** 2)) * 0.55;
      const [hr, hg, hb] = color(Math.atan2(dy, dx) + 1.2);
      r = mix(r, hr, halo);
      g = mix(g, hg, halo);
      b = mix(b, hb, halo);
      // Orb body with a conic gradient and a white highlight.
      if (d < orb) {
        const edge = Math.min(1, (orb - d) / (size * 0.01));
        const [cr, cg, cb] = color(Math.atan2(dy, dx) + 3.5);
        const hx = x - (cx - orb * 0.3);
        const hy = y - (cy - orb * 0.3);
        const spec = Math.exp(-((Math.hypot(hx, hy) / (orb * 0.22)) ** 2));
        r = mix(r, mix(cr, 255, spec), edge);
        g = mix(g, mix(cg, 255, spec), edge);
        b = mix(b, mix(cb, 255, spec), edge);
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = Math.round(Math.min(255, r));
      raw[o + 1] = Math.round(Math.min(255, g));
      raw[o + 2] = Math.round(Math.min(255, b));
      raw[o + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const targets = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, false],
];
for (const [name, size, maskable] of targets) {
  writeFileSync(join(out, name), render(size, { maskable }));
  console.log(`[icons] ${name}`);
}
