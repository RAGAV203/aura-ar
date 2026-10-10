// Aura logo — single source of truth for every icon.
//
// The mark is an "A" drawn as an aurora arch: two luminous strokes rise to a
// glowing fingertip spark at the apex, crossed by a flowing aurora ribbon —
// gestures drawing light.
//
// Writes:
//   public/icons/logo-mark.svg        mark only, transparent (in-app wordmark)
//   public/icons/icon.svg             rounded tile (browser / manifest SVG icon)
//   public/icons/icon-192.png, icon-512.png       rounded tile
//   public/icons/icon-maskable-512.png            full-bleed, mark inside the safe zone
//   public/icons/apple-touch-icon.png (180)       full-bleed (iOS rounds it)
//   public/favicon.ico                            32 px PNG-in-ICO
//
// PNGs are rasterised with Playwright's Chromium (a dev dependency already used
// for end-to-end tests). Run: npm run icons   (needs `npx playwright install chromium` once)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const iconsDir = join(root, "public", "icons");
mkdirSync(iconsDir, { recursive: true });

const BACKGROUND = "#080914";

/** The mark in a 512×512 coordinate space. `id` keeps gradient ids unique per document. */
function mark(id) {
  return `
  <defs>
    <linearGradient id="${id}-legs" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#55E7FF"/>
      <stop offset="0.5" stop-color="#9B7CFF"/>
      <stop offset="1" stop-color="#FF79CF"/>
    </linearGradient>
    <linearGradient id="${id}-ribbon" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#55E7FF" stop-opacity="0"/>
      <stop offset="0.2" stop-color="#55E7FF"/>
      <stop offset="0.5" stop-color="#F6F4FF"/>
      <stop offset="0.8" stop-color="#FF79CF"/>
      <stop offset="1" stop-color="#FF79CF" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="${id}-spark">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="0.25" stop-color="#FFFFFF" stop-opacity="0.85"/>
      <stop offset="0.6" stop-color="#B39CFF" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#B39CFF" stop-opacity="0"/>
    </radialGradient>
    <filter id="${id}-glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="12"/>
    </filter>
  </defs>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <g filter="url(#${id}-glow)" opacity="0.75">
      <path d="M150 394 C176 298 206 190 256 120 C306 190 336 298 362 394" stroke="url(#${id}-legs)" stroke-width="34"/>
      <path d="M112 300 C168 258 212 334 256 298 C300 262 344 338 400 296" stroke="url(#${id}-ribbon)" stroke-width="20"/>
    </g>
    <path d="M150 394 C176 298 206 190 256 120 C306 190 336 298 362 394" stroke="url(#${id}-legs)" stroke-width="28"/>
    <path d="M112 300 C168 258 212 334 256 298 C300 262 344 338 400 296" stroke="url(#${id}-ribbon)" stroke-width="13"/>
  </g>
  <circle cx="256" cy="116" r="64" fill="url(#${id}-spark)"/>
  <path d="M256 70 L262 110 L302 116 L262 122 L256 162 L250 122 L210 116 L250 110 Z" fill="#FFFFFF" opacity="0.95"/>`;
}

function backdrop(id, rounded) {
  return `
  <defs>
    <radialGradient id="${id}-bg" cx="0.5" cy="0.58" r="0.62">
      <stop offset="0" stop-color="#2A1F5C"/>
      <stop offset="0.55" stop-color="#120F2A"/>
      <stop offset="1" stop-color="${BACKGROUND}"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ""} fill="url(#${id}-bg)"/>`;
}

/** Tile with background; `scale` shrinks the mark around the centre (maskable safe zone). */
function tile({ rounded, scale = 1, id = "aura" }) {
  const offset = (512 * (1 - scale)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${backdrop(id, rounded)}
  <g transform="translate(${offset} ${offset + 12 * scale}) scale(${scale})">${mark(id)}
  </g>
</svg>
`;
}

const markOnly = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="96 56 320 360">${mark("aura-mark")}
</svg>
`;

writeFileSync(join(iconsDir, "logo-mark.svg"), markOnly);
writeFileSync(join(iconsDir, "icon.svg"), tile({ rounded: true }));
console.log("[icons] logo-mark.svg, icon.svg");

const rasters = [
  { file: "icon-192.png", size: 192, svg: tile({ rounded: true }) },
  { file: "icon-512.png", size: 512, svg: tile({ rounded: true }) },
  // Maskable: content must fit the central 80% circle, background must be full-bleed.
  { file: "icon-maskable-512.png", size: 512, svg: tile({ rounded: false, scale: 0.72 }) },
  { file: "apple-touch-icon.png", size: 180, svg: tile({ rounded: false, scale: 0.86 }) },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const render = async (svg, size) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`,
    );
    return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  };
  for (const { file, size, svg } of rasters) {
    writeFileSync(join(iconsDir, file), await render(svg, size));
    console.log(`[icons] ${file}`);
  }
  // favicon.ico: a single 32×32 PNG wrapped in an ICO container.
  const png = await render(tile({ rounded: true }), 32);
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // image count
  header.writeUInt8(32, 6); // width
  header.writeUInt8(32, 7); // height
  header.writeUInt8(0, 8); // palette
  header.writeUInt8(0, 9); // reserved
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14); // image size
  header.writeUInt32LE(22, 18); // image offset
  writeFileSync(join(root, "public", "favicon.ico"), Buffer.concat([header, png]));
  console.log("[icons] favicon.ico");
} finally {
  await browser.close();
}
