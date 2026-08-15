#!/usr/bin/env node
// Generates the PWA's public/icons/icon-192.png and icon-512.png.
//
// Pure Node (only the built-in `zlib` module) — deliberately not the
// `canvas` npm package the original spec suggested, which requires a
// native build (node-gyp/Cairo) this project doesn't otherwise need and
// that's a real risk to install reliably on Windows. This hand-encodes a
// minimal RGBA PNG (IHDR/IDAT/IEND chunks, zlib-deflated pixel data) —
// solid #1e40af background with a centered white circle, kept well inside
// the ~40%-radius "safe zone" so it survives Android's maskable-icon
// cropping. No literal "FT" text — rendering real glyphs without a canvas
// library isn't practical, so this stays a simple geometric mark.
//
// Run with: npm run generate-icons

import { writeFileSync } from 'fs'
import { deflateSync } from 'zlib'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(__dirname, '..', 'public', 'icons')

const BACKGROUND = [0x1e, 0x40, 0xaf] // #1e40af
const MARK = [0xff, 0xff, 0xff] // white
const MARK_RADIUS_FRACTION = 0.32 // inside the maskable safe zone (~40%)

function buildCrcTable() {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
}
const CRC_TABLE = buildCrcTable()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const lengthBuf = Buffer.alloc(4)
  lengthBuf.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([lengthBuf, typeBuf, data, crcBuf])
}

function buildIHDR(size) {
  const data = Buffer.alloc(13)
  data.writeUInt32BE(size, 0) // width
  data.writeUInt32BE(size, 4) // height
  data.writeUInt8(8, 8) // bit depth
  data.writeUInt8(6, 9) // color type 6 = RGBA
  data.writeUInt8(0, 10) // compression method
  data.writeUInt8(0, 11) // filter method
  data.writeUInt8(0, 12) // interlace method
  return pngChunk('IHDR', data)
}

function pixelAt(x, y, size) {
  const center = size / 2
  const radius = size * MARK_RADIUS_FRACTION
  const dx = x + 0.5 - center
  const dy = y + 0.5 - center
  const [r, g, b] = Math.sqrt(dx * dx + dy * dy) <= radius ? MARK : BACKGROUND
  return [r, g, b, 255]
}

function buildRawScanlines(size) {
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  let offset = 0
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0 // filter type: None
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelAt(x, y, size)
      raw[offset++] = r
      raw[offset++] = g
      raw[offset++] = b
      raw[offset++] = a
    }
  }
  return raw
}

function buildPng(size) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = buildIHDR(size)
  const idat = pngChunk('IDAT', deflateSync(buildRawScanlines(size), { level: 9 }))
  const iend = pngChunk('IEND', Buffer.alloc(0))
  return Buffer.concat([signature, ihdr, idat, iend])
}

for (const size of [192, 512]) {
  const png = buildPng(size)
  const outPath = path.join(OUT_DIR, `icon-${size}.png`)
  writeFileSync(outPath, png)
  console.log(`Wrote ${outPath} (${png.length} bytes)`)
}
