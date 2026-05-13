// Generates PWA icons from an inline Swords SVG. Run once; commit results.
//   node scripts/generate-icons.mjs
import sharp from "sharp";
import { writeFile, mkdir } from "node:fs/promises";

const PRIMARY = "#16a34a";
const FG = "#ffffff";

function svg(size, masked = false) {
  // For maskable, draw inside the safe zone (centered, 80% of canvas).
  const inset = masked ? size * 0.1 : 0;
  const drawSize = masked ? size * 0.8 : size;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${PRIMARY}"/>
  <g transform="translate(${inset} ${inset}) scale(${drawSize / 24})">
    <!-- lucide Swords (24x24) -->
    <g fill="none" stroke="${FG}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="14.5,17.5 3,6 3,3 6,3 17.5,14.5"/>
      <line x1="13" y1="19" x2="19" y2="13"/>
      <line x1="16" y1="16" x2="20" y2="20"/>
      <line x1="19" y1="21" x2="21" y2="19"/>
      <polyline points="14.5,6.5 18,3 21,3 21,6 17.5,9.5"/>
      <line x1="5" y1="14" x2="9" y2="18"/>
      <line x1="7" y1="17" x2="4" y2="20"/>
      <line x1="3" y1="19" x2="5" y2="21"/>
    </g>
  </g>
</svg>`;
}

await mkdir("public/icons", { recursive: true });

const targets = [
  { name: "icon-192.png", size: 192, masked: false },
  { name: "icon-512.png", size: 512, masked: false },
  { name: "icon-maskable-512.png", size: 512, masked: true },
  { name: "apple-icon-180.png", size: 180, masked: false },
];

for (const t of targets) {
  const buf = Buffer.from(svg(t.size, t.masked));
  await sharp(buf).png().toFile(`public/${t.name}`);
  console.log("wrote", t.name);
}

await writeFile("public/icon.svg", svg(512));
console.log("wrote icon.svg");
