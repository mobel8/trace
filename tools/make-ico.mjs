// tools/make-ico.mjs — PNG 256×256 → trace.ico (coins arrondis transparents).
// Usage : node tools/make-ico.mjs <entree.png> <sortie.ico>
// Décode le PNG (RGBA 8 bits), met alpha=0 hors du carré arrondi, réencode, emballe en ICO.
import fs from 'node:fs';
import zlib from 'node:zlib';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) { console.error('usage: node make-ico.mjs in.png out.ico'); process.exit(1); }

/* ---------- décodage PNG ---------- */
const buf = fs.readFileSync(inPath);
if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('pas un PNG');
let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
const idat = [];
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos);
  const type = buf.toString('ascii', pos + 4, pos + 8);
  const data = buf.subarray(pos + 8, pos + 8 + len);
  if (type === 'IHDR') {
    width = data.readUInt32BE(0); height = data.readUInt32BE(4);
    bitDepth = data[8]; colorType = data[9];
    if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) throw new Error('attendu RGB(A) 8 bits, reçu depth=' + bitDepth + ' color=' + colorType);
    if (data[12] !== 0) throw new Error('PNG entrelacé non géré');
  } else if (type === 'IDAT') idat.push(data);
  else if (type === 'IEND') break;
  pos += 12 + len;
}
const raw = zlib.inflateSync(Buffer.concat(idat));
const BPP_IN = colorType === 6 ? 4 : 3;
const strideIn = width * BPP_IN;
const dec = Buffer.alloc(height * strideIn);
const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
for (let y = 0; y < height; y++) {
  const filter = raw[y * (strideIn + 1)];
  const row = raw.subarray(y * (strideIn + 1) + 1, (y + 1) * (strideIn + 1));
  for (let x = 0; x < strideIn; x++) {
    const left = x >= BPP_IN ? dec[y * strideIn + x - BPP_IN] : 0;
    const up = y > 0 ? dec[(y - 1) * strideIn + x] : 0;
    const upLeft = y > 0 && x >= BPP_IN ? dec[(y - 1) * strideIn + x - BPP_IN] : 0;
    let v = row[x];
    if (filter === 1) v += left;
    else if (filter === 2) v += up;
    else if (filter === 3) v += (left + up) >> 1;
    else if (filter === 4) v += paeth(left, up, upLeft);
    else if (filter !== 0) throw new Error('filtre PNG inconnu ' + filter);
    dec[y * strideIn + x] = v & 0xff;
  }
}
// normalisation en RGBA
const BPP = 4, stride = width * BPP;
const px = Buffer.alloc(height * stride);
for (let i = 0; i < width * height; i++) {
  px[i * 4] = dec[i * BPP_IN];
  px[i * 4 + 1] = dec[i * BPP_IN + 1];
  px[i * 4 + 2] = dec[i * BPP_IN + 2];
  px[i * 4 + 3] = BPP_IN === 4 ? dec[i * BPP_IN + 3] : 255;
}

/* ---------- masque coins arrondis ---------- */
// L'icône source : tuile arrondie rx=8.5 sur viewBox 32 → rayon = 8.5/32 × taille.
const R = (8.5 / 32) * width;
const inside = (x, y) => {
  const cx = x < R ? R : x > width - 1 - R ? width - 1 - R : x;
  const cy = y < R ? R : y > height - 1 - R ? height - 1 - R : y;
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= R * R;
};
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (!inside(x, y)) px[(y * width + x) * BPP + 3] = 0;
  }
}

/* ---------- réencodage PNG ---------- */
const filtered = Buffer.alloc(height * (stride + 1));
for (let y = 0; y < height; y++) {
  filtered[y * (stride + 1)] = 0;
  px.copy(filtered, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
}
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (b) => {
  let c = 0xffffffff;
  for (const byte of b) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(filtered, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

/* ---------- emballage ICO (PNG embarqué, valide ≥ Vista) ---------- */
const ico = Buffer.alloc(6 + 16);
ico.writeUInt16LE(0, 0);          // réservé
ico.writeUInt16LE(1, 2);          // type icône
ico.writeUInt16LE(1, 4);          // 1 image
ico[6] = width >= 256 ? 0 : width;
ico[7] = height >= 256 ? 0 : height;
ico[8] = 0; ico[9] = 0;
ico.writeUInt16LE(1, 10);         // plans
ico.writeUInt16LE(32, 12);        // bpp
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18);        // offset
fs.writeFileSync(outPath, Buffer.concat([ico, png]));

// vérification : alpha nul dans le coin, opaque au centre
const corner = px[3], center = px[((height / 2 | 0) * width + (width / 2 | 0)) * BPP + 3];
console.log('OK ' + outPath + ' (' + (6 + 16 + png.length) + ' octets) — alpha coin=' + corner + ', centre=' + center);
if (corner !== 0 || center !== 255) { console.error('masque incorrect'); process.exit(1); }
