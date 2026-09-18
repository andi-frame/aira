// Minimal pure JS PNG generator for AIRA icons
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPng(size) {
  const width = size;
  const height = size;
  const buffer = Buffer.alloc(width * height * 4);

  const cx = width / 2;
  const cy = height / 2;
  const r = width * 0.46;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= r) {
        // Gradient background from #007DFF to #0254B8
        const t = (y / height);
        const rVal = Math.round(0 * (1 - t) + 2 * t);
        const gVal = Math.round(125 * (1 - t) + 84 * t);
        const bVal = Math.round(255 * (1 - t) + 184 * t);

        // Anti-aliasing edge
        let alpha = 255;
        if (dist > r - 1.2) {
          alpha = Math.round(255 * (r - dist) / 1.2);
          if (alpha < 0) alpha = 0;
        }

        // Draw soundwave / AI stylized curves inside
        const normX = (x - cx) / (width * 0.5);
        const normY = (y - cy) / (height * 0.5);

        let isGlyph = false;
        // Central bar
        if (Math.abs(normX) < 0.12 && Math.abs(normY) < 0.6) isGlyph = true;
        // Left bar
        if (Math.abs(normX + 0.3) < 0.11 && Math.abs(normY) < 0.38) isGlyph = true;
        // Right bar
        if (Math.abs(normX - 0.3) < 0.11 && Math.abs(normY) < 0.38) isGlyph = true;
        // Outer dot on top right
        const dotDist = Math.sqrt((normX - 0.35)*(normX - 0.35) + (normY + 0.35)*(normY + 0.35));
        if (dotDist < 0.08) isGlyph = true;

        if (isGlyph) {
          buffer[idx] = 255;     // R
          buffer[idx + 1] = 255; // G
          buffer[idx + 2] = 255; // B
          buffer[idx + 3] = alpha;
        } else {
          buffer[idx] = rVal;
          buffer[idx + 1] = gVal;
          buffer[idx + 2] = bVal;
          buffer[idx + 3] = alpha;
        }
      } else {
        buffer[idx] = 0;
        buffer[idx + 1] = 0;
        buffer[idx + 2] = 0;
        buffer[idx + 3] = 0;
      }
    }
  }

  return encodeRawRgbaToPng(width, height, buffer);
}

function encodeRawRgbaToPng(width, height, rgbaBuffer) {
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  let srcOffset = 0;
  let dstOffset = 0;

  for (let y = 0; y < height; y++) {
    scanlines[dstOffset++] = 0;
    rgbaBuffer.copy(scanlines, dstOffset, srcOffset, srcOffset + width * 4);
    srcOffset += width * 4;
    dstOffset += width * 4;
  }

  const compressed = zlib.deflateSync(scanlines);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdrChunk = createChunk('IHDR', ihdrData);

  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuf = Buffer.from(type, 'ascii');
  const typeAndData = Buffer.concat([typeBuf, data]);

  const crc = crc32(typeAndData);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);

  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const iconsDir = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

[16, 48, 128].forEach(size => {
  const png = createPng(size);
  const outPath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`Generated ${outPath} (${png.length} bytes)`);
});
