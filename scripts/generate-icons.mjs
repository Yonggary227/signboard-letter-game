// 의존성 없는 PNG 아이콘 생성기 (네이비 배경 + 오렌지 패널 + 흰 음절칸 3개)
// 실행: node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public')
mkdirSync(outDir, { recursive: true })

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const NAVY = hex('#0f172a')
const ORANGE = hex('#f97316')
const WHITE = hex('#ffffff')

function roundRect(buf, S, x0, y0, w, h, rad, [r, g, b], a = 255) {
  const x1 = x0 + w, y1 = y0 + h
  for (let y = Math.max(0, y0 | 0); y < Math.min(S, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, x0 | 0); x < Math.min(S, Math.ceil(x1)); x++) {
      // 라운드 코너 판정
      let dx = 0, dy = 0
      if (x < x0 + rad) dx = x0 + rad - x
      else if (x > x1 - rad) dx = x - (x1 - rad)
      if (y < y0 + rad) dy = y0 + rad - y
      else if (y > y1 - rad) dy = y - (y1 - rad)
      if (dx * dx + dy * dy > rad * rad) continue
      const i = (y * S + x) * 4
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a
    }
  }
}

function makePng(S) {
  const buf = Buffer.alloc(S * S * 4)
  // 배경 네이비
  for (let p = 0; p < S * S; p++) {
    buf[p * 4] = NAVY[0]; buf[p * 4 + 1] = NAVY[1]; buf[p * 4 + 2] = NAVY[2]; buf[p * 4 + 3] = 255
  }
  // 오렌지 패널
  const m = S * 0.14
  roundRect(buf, S, m, m, S - 2 * m, S - 2 * m, S * 0.16, ORANGE)
  // 흰 음절칸 3개
  const sq = S * 0.17, gap = S * 0.06
  const totalW = 3 * sq + 2 * gap
  const sx = (S - totalW) / 2
  const sy = (S - sq) / 2
  for (let k = 0; k < 3; k++) {
    roundRect(buf, S, sx + k * (sq + gap), sy, sq, sq, sq * 0.22, WHITE)
  }
  return encodePng(buf, S, S)
}

// ── 최소 PNG 인코더 ──────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}
function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  // 스캔라인 (필터 0)
  const raw = Buffer.alloc(h * (1 + w * 4))
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0
    rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4)
  }
  const idat = deflateSync(raw, { level: 9 })
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

for (const S of [512, 192, 180]) {
  writeFileSync(join(outDir, `icon-${S}.png`), makePng(S))
  console.log('wrote', `public/icon-${S}.png`)
}
