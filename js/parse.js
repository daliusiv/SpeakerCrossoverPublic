// FRD / ZMA text parsing and writing, plus a tiny ZIP reader for manufacturer downloads.

function parseTable(text) {
  const rows = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || !/^[-+.\d]/.test(line)) continue; // comments / headers
    let parts = line.split(/[\s;]+/).filter(Boolean);
    const decimalComma = parts.length >= 2 && parts.every(p => /^[-+]?\d+(,\d+)?([eE][-+]?\d+)?$/.test(p));
    if (decimalComma) parts = parts.map(p => p.replace(',', '.'));
    else parts = line.split(/[\s;,]+/).filter(Boolean);
    const nums = parts.map(Number);
    if (nums.length < 2 || !nums.slice(0, 2).every(isFinite)) continue;
    rows.push(nums);
  }
  rows.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of rows) if (r[0] > 0 && (!out.length || r[0] > out[out.length - 1][0])) out.push(r);
  return out;
}

const r4 = v => +v.toPrecision(5);
const r2 = v => Math.round(v * 100) / 100;

/** Parse an FRD file: frequency, dB, [phase in degrees]. */
export function parseFRD(text, name = 'response.frd') {
  const rows = parseTable(text);
  if (rows.length < 3) throw new Error('No frequency/dB data found');
  const hasPh = rows.every(r => r.length >= 3 && isFinite(r[2]));
  return {
    name, stamp: Date.now() + Math.random(),
    f: rows.map(r => r4(r[0])),
    db: rows.map(r => r2(r[1])),
    ph: hasPh ? rows.map(r => Math.round(r[2] * 10) / 10) : null,
  };
}

/** Parse a ZMA file: frequency, ohms, [phase in degrees]. */
export function parseZMA(text, name = 'impedance.zma') {
  const rows = parseTable(text);
  if (rows.length < 3) throw new Error('No frequency/impedance data found');
  if (rows.some(r => r[1] <= 0)) throw new Error('Impedance values must be positive ohms (is this an FRD file?)');
  const hasPh = rows.every(r => r.length >= 3 && isFinite(r[2]));
  return {
    name, stamp: Date.now() + Math.random(),
    f: rows.map(r => r4(r[0])),
    mag: rows.map(r => r4(r[1])),
    ph: hasPh ? rows.map(r => Math.round(r[2] * 10) / 10) : null,
  };
}

const fmtF = f => f.toFixed(f < 100 ? 3 : f < 1000 ? 2 : 1);

/** Write FRD text from a grid and complex response {re, im}. */
export function toFRD(title, grid, c) {
  const lines = [`* ${title}`, '* Exported by Crossover Designer', '* Freq(Hz)  SPL(dB)  Phase(deg)'];
  for (let k = 0; k < grid.length; k++) {
    const m = Math.hypot(c.re[k], c.im[k]);
    lines.push(`${fmtF(grid[k])}\t${(20 * Math.log10(m + 1e-12)).toFixed(3)}\t${(Math.atan2(c.im[k], c.re[k]) * 180 / Math.PI).toFixed(2)}`);
  }
  return lines.join('\n') + '\n';
}

/** Write ZMA text from a grid and complex impedance. */
export function toZMA(title, grid, c) {
  const lines = [`* ${title}`, '* Exported by Crossover Designer', '* Freq(Hz)  Ohm  Phase(deg)'];
  for (let k = 0; k < grid.length; k++) {
    lines.push(`${fmtF(grid[k])}\t${Math.hypot(c.re[k], c.im[k]).toFixed(4)}\t${(Math.atan2(c.im[k], c.re[k]) * 180 / Math.PI).toFixed(2)}`);
  }
  return lines.join('\n') + '\n';
}

export const isZip = buf => {
  const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  return b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;
};

/** List the files inside a ZIP archive. Each entry has name and async text(). */
export function readZip(buf) {
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid ZIP file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const loff = dv.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/') || name.startsWith('__MACOSX')) continue;
    entries.push({
      name,
      async text() {
        const ln = dv.getUint16(loff + 26, true), lx = dv.getUint16(loff + 28, true);
        const data = new Uint8Array(buf, loff + 30 + ln + lx, csize);
        if (method === 0) return dec.decode(data);
        if (method !== 8) throw new Error('Unsupported ZIP compression');
        if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unzip files; please extract the ZIP first');
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return dec.decode(await new Response(stream).arrayBuffer());
      },
    });
  }
  return entries;
}

/** Guess whether a filename is an FRD or a ZMA file. */
export function guessKind(name) {
  const n = name.toLowerCase();
  if (/\.zma$|imp|zma|ohm/.test(n)) return 'zma';
  if (/\.frd$|spl|frd|resp|freq|axis|deg/.test(n)) return 'frd';
  return null;
}

export const isDataFile = name => /\.(frd|zma|txt|csv|dat)$/i.test(name);
