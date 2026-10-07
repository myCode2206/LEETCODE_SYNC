// Generates the extension icons (rounded square + check mark) as PNGs without dependencies.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');
mkdirSync(out, { recursive: true });

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size);
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const clamp = (v) => Math.max(0, Math.min(1, v));
function segDist(px, py, ax, ay, bx, by) {
  const t = clamp(
    ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2),
  );
  return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
}
function pixel(x, y, s) {
  const u = x / s,
    v = y / s,
    r = 0.22;
  // rounded-square coverage
  const dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0),
    dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
  const bg = clamp((r - Math.hypot(dx, dy)) * s + 0.5);
  // check mark
  const w = 0.075;
  const d = Math.min(segDist(u, v, 0.27, 0.52, 0.43, 0.68), segDist(u, v, 0.43, 0.68, 0.74, 0.34));
  const fg = clamp((w - d) * s + 0.5);
  const [br, bgc, bb] = [31, 111, 235];
  return [
    Math.round(br + (255 - br) * fg),
    Math.round(bgc + (255 - bgc) * fg),
    Math.round(bb + (255 - bb) * fg),
    Math.round(255 * bg),
  ];
}
for (const size of [16, 32, 48, 128])
  writeFileSync(resolve(out, `icon-${size}.png`), png(size, pixel));
console.log(`Icons written to ${out}`);
