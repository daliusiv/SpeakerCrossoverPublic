// Small DSP helpers: FFT, phase unwrapping, interpolation and minimum-phase reconstruction.

/** In-place radix-2 complex FFT. Length must be a power of two. */
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (inverse ? 1 : -1);
    const half = len >> 1;
    // Precompute twiddles for this stage (more accurate than a running product).
    const wr = new Float64Array(half), wi = new Float64Array(half);
    for (let k = 0; k < half; k++) { wr[k] = Math.cos(ang * k); wi[k] = Math.sin(ang * k); }
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const xr = re[b] * wr[k] - im[b] * wi[k];
        const xi = re[b] * wi[k] + im[b] * wr[k];
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/** Unwrap a phase array in radians. */
export function unwrap(ph) {
  const out = new Float64Array(ph.length);
  if (!ph.length) return out;
  out[0] = ph[0];
  let off = 0;
  for (let i = 1; i < ph.length; i++) {
    let d = ph[i] - ph[i - 1];
    if (d > Math.PI) off -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
    else if (d < -Math.PI) off += 2 * Math.PI * Math.round(-d / (2 * Math.PI));
    out[i] = ph[i] + off;
  }
  return out;
}

/** Interpolate ys(xs) onto grid, linear in log-frequency, holding the end values. */
export function interpLog(xs, ys, grid) {
  const n = xs.length, out = new Float64Array(grid.length);
  let j = 0;
  for (let i = 0; i < grid.length; i++) {
    const f = grid[i];
    if (f <= xs[0]) { out[i] = ys[0]; continue; }
    if (f >= xs[n - 1]) { out[i] = ys[n - 1]; continue; }
    while (j < n - 2 && xs[j + 1] < f) j++;
    const t = Math.log(f / xs[j]) / Math.log(xs[j + 1] / xs[j]);
    out[i] = ys[j] + t * (ys[j + 1] - ys[j]);
  }
  return out;
}

const N_MP = 65536, FS_MP = 96000;

/**
 * Minimum-phase (radians) for a magnitude response given in dB, evaluated on `grid`.
 * Uses the folded real cepstrum. Below the first data point the magnitude is
 * extended with the slope of the lowest third-octave so the low end does not
 * produce a phase artefact.
 */
export function minimumPhase(fIn, dbIn, grid) {
  const N = N_MP, half = N / 2, df = FS_MP / N;
  const bins = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) bins[k] = Math.max(k, 0.5) * df;
  const db = interpLog(fIn, dbIn, bins);
  const f0 = fIn[0], db0 = dbIn[0];
  let j = 1;
  while (j < fIn.length - 1 && fIn[j] < f0 * 1.26) j++;
  let slope = (dbIn[j] - db0) / Math.log2(fIn[j] / f0);
  if (!isFinite(slope)) slope = 0;
  slope = Math.min(24, Math.max(0, slope));
  const re = new Float64Array(N), im = new Float64Array(N);
  const LN = Math.LN10 / 20;
  for (let k = 0; k <= half; k++) {
    let v = db[k];
    if (bins[k] < f0) v = Math.max(db0 - slope * Math.log2(f0 / bins[k]), db0 - 120);
    re[k] = v * LN;
    if (k > 0 && k < half) re[N - k] = re[k];
  }
  fft(re, im, true); // real cepstrum in re
  const cr = new Float64Array(N), ci = new Float64Array(N);
  cr[0] = re[0];
  for (let n = 1; n < half; n++) cr[n] = 2 * re[n];
  cr[half] = re[half];
  fft(cr, ci, false); // ci now holds minimum phase per bin
  const out = new Float64Array(grid.length);
  for (let i = 0; i < grid.length; i++) {
    const x = grid[i] / df;
    const k = Math.min(half - 1, Math.floor(x));
    const t = x - k;
    out[i] = ci[k] + t * (ci[k + 1] - ci[k]);
  }
  return out;
}
