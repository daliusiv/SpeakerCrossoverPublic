// Loudspeaker + passive crossover simulation.
// Units used in the project data: R in ohms, L in mH, C in µF, Le in mH, Vas/Vb in litres,
// offsets in mm, sensitivity in dB SPL @ 2.83 V / 1 m.

import { interpLog, minimumPhase, unwrap } from './dsp.js';

export const SPEED_OF_SOUND = 343;
const TAU = 2 * Math.PI;

export function logGrid(fmin, fmax, n) {
  const g = new Float64Array(n);
  const a = Math.log(fmin), b = Math.log(fmax);
  for (let i = 0; i < n; i++) g[i] = Math.exp(a + (b - a) * i / (n - 1));
  return g;
}

const cplx = n => ({ re: new Float64Array(n), im: new Float64Array(n) });

// ---------------------------------------------------------------- T/S model

export function tsValid(ts) {
  return !!ts && ts.fs > 0 && ts.re > 0 && ts.qms > 0 && ts.qes > 0 && isFinite(ts.sens);
}

export const qts = ts => (ts.qms > 0 && ts.qes > 0 ? (ts.qms * ts.qes) / (ts.qms + ts.qes) : NaN);

/** Sealed box resonance and Q. */
export function sealedAlignment(ts) {
  const a = ts.vas / ts.vb;
  const k = Math.sqrt(1 + a);
  return { fc: ts.fs * k, qtc: qts(ts) * k };
}

/** Quick box suggestions: sealed Qtc 0.707, vented per Keele's rule of thumb. */
export function suggestBox(ts, box) {
  const q = qts(ts);
  if (box === 'sealed') {
    const a = (0.707 / q) ** 2 - 1;
    return a > 0.05 ? { vb: +(ts.vas / a).toPrecision(3) } : { vb: +(ts.vas * 10).toPrecision(3) };
  }
  if (box === 'vented') {
    return { vb: +(15 * q ** 2.87 * ts.vas).toPrecision(3), fb: +(0.42 * ts.fs * q ** -0.9).toPrecision(3) };
  }
  return {};
}

/**
 * Electro-mechanical model of a driver from T/S data, including the enclosure.
 * Returns complex SPL (|H| = SPL in "pressure units" so 20log10|H| is dB) and impedance.
 */
export function tsSimulate(ts, grid) {
  const n = grid.length, H = cplx(n), Z = cplx(n);
  const Re = +ts.re, Le = (+ts.le || 0) / 1000, fs = +ts.fs, Qms = +ts.qms, Qes = +ts.qes;
  const ws = TAU * fs;
  const Res = Re * Qms / Qes, Cmes = Qes / (ws * Re), Lces = 1 / (ws * ws * Cmes);
  const vas = +ts.vas, vb = +ts.vb;
  const box = ts.box || 'ib';
  const useBox = (box === 'sealed' || box === 'vented') && vas > 0 && vb > 0;
  const Lceb = useBox ? Lces * vb / vas : 0;
  const Cmep = useBox && box === 'vented' && ts.fb > 0 ? 1 / ((TAU * ts.fb) ** 2 * Lceb) : 0;
  const vented = Cmep > 0;
  const sens = 10 ** ((isFinite(ts.sens) ? +ts.sens : 85) / 20);
  const bw = +ts.baffle > 0 ? +ts.baffle / 1000 : 0;
  const a = bw ? TAU * 115 / bw / Math.SQRT2 : 0;

  for (let k = 0; k < n; k++) {
    const w = TAU * grid[k];
    let yr = 1 / Res, yi = w * Cmes - 1 / (w * Lces);
    if (useBox) {
      if (vented) {
        let X = w * Lceb - 1 / (w * Cmep);
        if (Math.abs(X) < 1e-12) X = 1e-12;
        yi -= 1 / X;
      } else yi -= 1 / (w * Lceb);
    }
    const d = yr * yr + yi * yi;
    const zmr = yr / d, zmi = -yi / d;
    const zr = Re + zmr, zi = w * Le + zmi;
    Z.re[k] = zr; Z.im[k] = zi;
    // Vm/V = Zmot / Z
    const dz = zr * zr + zi * zi;
    const rr = (zmr * zr + zmi * zi) / dz, ri = (zmi * zr - zmr * zi) / dz;
    // pressure ~ jw * Vm, normalised to 1 in the mass-controlled region
    const g = w * Cmes * Re;
    let hr = -g * ri, hi = g * rr;
    if (vented) {
      const x = w * w * Lceb * Cmep;
      let den = 1 - x;
      if (Math.abs(den) < 1e-12) den = 1e-12;
      const fac = -x / den;
      hr *= fac; hi *= fac;
    }
    if (a) { // baffle step shelf: (s + a) / (s + 2a)
      const nr = a, ni = w, dr = 2 * a, di = w;
      const dd = dr * dr + di * di;
      const br = (nr * dr + ni * di) / dd, bi = (ni * dr - nr * di) / dd;
      const t = hr * br - hi * bi; hi = hr * bi + hi * br; hr = t;
    }
    H.re[k] = hr * sens; H.im[k] = hi * sens;
  }
  return { H, Z };
}

// ---------------------------------------------------------------- driver preparation

function fromMagPhase(db, ph, n) {
  const out = cplx(n);
  for (let k = 0; k < n; k++) {
    const m = 10 ** (db[k] / 20);
    out.re[k] = m * Math.cos(ph[k]); out.im[k] = m * Math.sin(ph[k]);
  }
  return out;
}

/**
 * Build the raw (unfiltered) acoustic response and impedance of a driver on a grid.
 * Measured FRD/ZMA data wins; otherwise the T/S model is used.
 */
export function prepareDriver(drv, grid) {
  const n = grid.length;
  const sim = tsValid(drv.ts) ? tsSimulate(drv.ts, grid) : null;
  let H, Z, srcH = 'ts', srcZ = 'ts';
  const frd = drv.frd;
  if (frd && frd.f && frd.f.length > 1) {
    const db = interpLog(frd.f, frd.db, grid);
    let ph;
    if (drv.phaseMode === 'min' || !frd.ph) ph = minimumPhase(frd.f, frd.db, grid);
    else ph = interpLog(frd.f, unwrap(frd.ph.map(p => p * Math.PI / 180)), grid);
    H = fromMagPhase(db, ph, n);
    srcH = 'frd';
  } else if (sim) H = sim.H;
  else { H = cplx(n); H.re.fill(10 ** (85 / 20)); srcH = 'none'; }

  const zma = drv.zma;
  if (zma && zma.f && zma.f.length > 1) {
    const mag = interpLog(zma.f, zma.mag, grid);
    let ph;
    if (zma.ph) ph = interpLog(zma.f, zma.ph.map(p => p * Math.PI / 180), grid);
    else ph = minimumPhase(zma.f, zma.mag.map(m => 20 * Math.log10(m)), grid);
    Z = cplx(n);
    for (let k = 0; k < n; k++) { Z.re[k] = mag[k] * Math.cos(ph[k]); Z.im[k] = mag[k] * Math.sin(ph[k]); }
    srcZ = 'zma';
  } else if (sim) Z = sim.Z;
  else { Z = cplx(n); Z.re.fill(8); srcZ = 'none'; }
  return { H, Z, srcH, srcZ };
}

/** Estimate Re and Le from T/S data or a prepared impedance curve (used by Zobel design). */
export function estimateReLe(drv, prep, grid) {
  let re = drv.ts && drv.ts.re > 0 ? +drv.ts.re : Infinity;
  if (!(re < Infinity)) for (let k = 0; k < grid.length; k++) re = Math.min(re, Math.hypot(prep.Z.re[k], prep.Z.im[k]));
  let le = drv.ts && drv.ts.le > 0 ? drv.ts.le / 1000 : 0;
  if (drv.zma || !le) {
    let k = 0;
    while (k < grid.length - 1 && grid[k] < 10000) k++;
    const m = Math.hypot(prep.Z.re[k], prep.Z.im[k]);
    if (m > re) le = Math.sqrt(m * m - re * re) / (TAU * grid[k]);
  }
  return { re, le };
}

// ---------------------------------------------------------------- crossover network

export const KINDS = {
  R: { label: 'Resistor', keys: ['R'] },
  L: { label: 'Inductor', keys: ['L', 'rL'] },
  C: { label: 'Capacitor', keys: ['C'] },
  RC: { label: 'R + C (Zobel)', keys: ['R', 'C'] },
  RLC: { label: 'R + L + C in series (trap)', keys: ['R', 'L', 'C'] },
  RLCp: { label: 'R ‖ L ‖ C (notch)', keys: ['R', 'L', 'C'] },
};
export const UNITS = { R: 'Ω', L: 'mH', C: 'µF', rL: 'Ω' };
export const DEFAULTS = {
  R: { R: 4 }, L: { L: 0.5, rL: 0.3 }, C: { C: 4.7 }, RC: { R: 6, C: 10 },
  RLC: { R: 2, L: 0.5, C: 10 }, RLCp: { R: 0, L: 0.5, C: 10 },
};

/** Complex impedance of a network element at angular frequency w. */
export function elemZ(el, w) {
  const R = +el.R || 0, L = (+el.L || 0) * 1e-3, C = Math.max(+el.C || 0, 1e-9) * 1e-6, rL = +el.rL || 0;
  switch (el.kind) {
    case 'R': return [Math.max(R, 1e-9), 0];
    case 'L': return [rL, w * L];
    case 'C': return [0, -1 / (w * C)];
    case 'RC': return [R, -1 / (w * C)];
    case 'RLC': return [R + rL, w * L - 1 / (w * C)];
    case 'RLCp': {
      const yr = R > 0 ? 1 / R : 0, yi = w * C - 1 / (w * Math.max(L, 1e-12));
      const d = Math.max(yr * yr + yi * yi, 1e-30);
      return [yr / d, -yi / d];
    }
  }
  return [0, 0];
}

/**
 * Evaluate a ladder network (elements listed from amplifier to driver) loaded by ZL.
 * Returns transfer V_driver / V_in and input impedance.
 */
export function ladder(net, zlr, zli, w) {
  // Walk from the load back to the amplifier with V_load = 1.
  let vr = 1, vi = 0;
  const d = zlr * zlr + zli * zli;
  let ir = zlr / d, ii = -zli / d;
  for (let i = net.length - 1; i >= 0; i--) {
    const el = net[i];
    if (el.off) continue;
    const [zr, zi] = elemZ(el, w);
    if (el.pos === 'series') {
      vr += ir * zr - ii * zi; vi += ir * zi + ii * zr;
    } else {
      const dz = zr * zr + zi * zi;
      if (dz < 1e-30) { ir += 1e15 * vr; ii += 1e15 * vi; continue; } // short
      const yr = zr / dz, yi = -zi / dz;
      ir += vr * yr - vi * yi; ii += vr * yi + vi * yr;
    }
  }
  const dv = vr * vr + vi * vi;
  const di = ir * ir + ii * ii;
  return {
    tr: vr / dv, ti: -vi / dv,                                   // T = 1 / V
    zr: (vr * ir + vi * ii) / di, zi: (vi * ir - vr * ii) / di,  // Zin = V / I
  };
}

/**
 * Simulate the whole system.
 * prepared: array (parallel to project.drivers) of {H, Z} on `grid`.
 */
export function simulate(project, prepared, grid) {
  const n = grid.length;
  const sum = cplx(n), Y = cplx(n);
  const drivers = project.drivers.map((drv, i) => {
    const p = prepared[i];
    const out = { H: cplx(n), Zin: cplx(n), raw: p.H };
    if (!drv.enabled) return out;
    const g = 10 ** ((+drv.gain || 0) / 20) * (drv.invert ? -1 : 1);
    const tau = (+drv.offset || 0) / 1000 / SPEED_OF_SOUND;
    for (let k = 0; k < n; k++) {
      const w = TAU * grid[k];
      const r = ladder(drv.network, p.Z.re[k], p.Z.im[k], w);
      const cr = Math.cos(-w * tau) * g, ci = Math.sin(-w * tau) * g;
      const tr = r.tr * cr - r.ti * ci, ti = r.tr * ci + r.ti * cr;
      const hr = p.H.re[k] * tr - p.H.im[k] * ti, hi = p.H.re[k] * ti + p.H.im[k] * tr;
      out.H.re[k] = hr; out.H.im[k] = hi;
      out.Zin.re[k] = r.zr; out.Zin.im[k] = r.zi;
      sum.re[k] += hr; sum.im[k] += hi;
      const dz = r.zr * r.zr + r.zi * r.zi;
      Y.re[k] += r.zr / dz; Y.im[k] -= r.zi / dz;
    }
    return out;
  });
  const Z = cplx(n);
  for (let k = 0; k < n; k++) {
    const d = Y.re[k] * Y.re[k] + Y.im[k] * Y.im[k];
    if (d > 0) { Z.re[k] = Y.re[k] / d; Z.im[k] = -Y.im[k] / d; } else Z.re[k] = 1e6;
  }
  return { drivers, sum, Z };
}

export const toDb = (c, k) => 20 * Math.log10(Math.hypot(c.re[k], c.im[k]) + 1e-12);
export const toDeg = (c, k) => Math.atan2(c.im[k], c.re[k]) * 180 / Math.PI;
export const mag = (c, k) => Math.hypot(c.re[k], c.im[k]);

/** Group delay in ms from a complex response on a log grid. */
export function groupDelay(c, grid) {
  const n = grid.length, out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1);
    let d = Math.atan2(c.im[b], c.re[b]) - Math.atan2(c.im[a], c.re[a]);
    d -= TAU * Math.round(d / TAU);
    out[k] = -d / (TAU * (grid[b] - grid[a])) * 1000;
  }
  return out;
}

// ---------------------------------------------------------------- automatic design

// Normalised ladder prototypes (zero source impedance, unit load, w = 1), amp side first.
export const ALIGNMENTS = {
  bw1: { label: '1st order', g: [1] },
  lr2: { label: '2nd Linkwitz-Riley', g: [2, 0.5] },
  bes2: { label: '2nd Bessel', g: [1.7321, 0.5774] },
  bw2: { label: '2nd Butterworth', g: [1.4142, 0.7071] },
  bw3: { label: '3rd Butterworth', g: [1.5, 1.3333, 0.5] },
  lr4: { label: '4th Linkwitz-Riley', g: [1.8856, 1.5910, 0.9428, 0.35355] },
};

let uid = 1;
export const newId = () => 'e' + Date.now().toString(36) + (uid++).toString(36);

export function makeElement(pos, kind, vals = {}) {
  return { id: newId(), pos, kind, ...DEFAULTS[kind], ...vals };
}

function filterSection(type, fc, align, R) {
  const g = (ALIGNMENTS[align] || ALIGNMENTS.lr2).g;
  const w = TAU * fc;
  return g.map((gi, i) => {
    const series = i % 2 === 0;
    const pos = series ? 'series' : 'shunt';
    const isL = type === 'lp' ? series : !series;
    if (isL) {
      const L = type === 'lp' ? gi * R / w : R / (gi * w);
      return makeElement(pos, 'L', { L: +(L * 1000).toPrecision(3), rL: +(0.25 + L * 1000 * 0.3).toFixed(2) });
    }
    const C = type === 'lp' ? gi / (R * w) : 1 / (gi * w * R);
    return makeElement(pos, 'C', { C: +(C * 1e6).toPrecision(3) });
  });
}

export function lpadValues(Z, db) {
  const a = 10 ** (-Math.abs(db) / 20);
  return { rs: Z * (1 - a), rp: Z * a / (1 - a) };
}

/**
 * Replace a driver's network with a textbook starting point.
 * design: {type: 'lp'|'hp'|'bp'|'none', fc, fc2, align, align2, pad, zobel}
 */
export function designNetwork(drv, prep, grid) {
  const d = drv.design;
  const net = [];
  const { re, le } = estimateReLe(drv, prep, grid);
  const zAt = f => {
    let k = 0;
    while (k < grid.length - 1 && grid[k] < f) k++;
    return Math.hypot(prep.Z.re[k], prep.Z.im[k]);
  };
  let zobel = null;
  if (d.zobel && le > 0 && isFinite(re)) {
    const R = 1.25 * re;
    zobel = makeElement('shunt', 'RC', { R: +R.toPrecision(2), C: +(le / (R * R) * 1e6).toPrecision(2) });
  }
  const Rnom = f => (zobel ? Math.min(zAt(f), zobel.R) : zAt(f));
  if (d.type === 'hp') net.push(...filterSection('hp', d.fc, d.align, Rnom(d.fc)));
  if (d.type === 'lp') net.push(...filterSection('lp', d.fc, d.align, Rnom(d.fc)));
  if (d.type === 'bp') {
    net.push(...filterSection('hp', d.fc2, d.align2 || d.align, Rnom(d.fc2)));
    net.push(...filterSection('lp', d.fc, d.align, Rnom(d.fc)));
  }
  if (d.pad > 0) {
    const fref = d.type === 'lp' ? d.fc / 2 : d.type === 'hp' ? d.fc * 2 : d.type === 'bp' ? Math.sqrt(d.fc * d.fc2) : 1000;
    const { rs, rp } = lpadValues(Rnom(fref), d.pad);
    net.push(makeElement('series', 'R', { R: +rs.toPrecision(2) }), makeElement('shunt', 'R', { R: +rp.toPrecision(2) }));
  }
  if (zobel) net.push(zobel);
  return net;
}

// ---------------------------------------------------------------- E-series rounding

const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];

export function roundE(v, series = 'E12') {
  if (!(v > 0)) return v;
  const s = series === 'E24' ? E24 : E12;
  const e = Math.floor(Math.log10(v));
  const m = v / 10 ** e;
  let best = s[0], bd = Infinity;
  for (const c of [...s, 10]) {
    const dd = Math.abs(Math.log(m / c));
    if (dd < bd) { bd = dd; best = c; }
  }
  return +(best * 10 ** e).toPrecision(3);
}

export function roundNetwork(project) {
  for (const drv of project.drivers) for (const el of drv.network) {
    if (el.lock) continue;
    for (const key of KINDS[el.kind].keys) {
      if (key === 'rL' || !(el[key] > 0)) continue;
      el[key] = roundE(el[key], key === 'R' ? 'E24' : 'E12');
    }
  }
}

// ---------------------------------------------------------------- optimiser

/** Error of the summed response vs. a flat target, plus an impedance penalty. */
export function costFn(project, prepared, grid, opt) {
  const res = simulate(project, prepared, grid);
  let e = 0, n = 0, zmin = Infinity;
  for (let k = 0; k < grid.length; k++) {
    const f = grid[k];
    if (f < opt.lo || f > opt.hi) continue;
    const d = toDb(res.sum, k) - opt.level;
    e += d * d; n++;
    zmin = Math.min(zmin, mag(res.Z, k));
  }
  let c = Math.sqrt(e / Math.max(n, 1));
  if (opt.zmin > 0 && zmin < opt.zmin) c += 3 * (opt.zmin - zmin);
  return c;
}

/** Collect optimisable parameters (unlocked R/L/C values). */
export function paramRefs(project) {
  const refs = [];
  project.drivers.forEach(drv => {
    if (!drv.enabled) return;
    drv.network.forEach(el => {
      if (el.lock || el.off) return;
      for (const key of KINDS[el.kind].keys) if (key !== 'rL' && el[key] > 0) refs.push({ el, key });
    });
  });
  return refs;
}

/** Nelder-Mead in log space, as a generator so the UI can stay responsive. */
export function* optimizer(project, prepared, grid, opt) {
  const refs = paramRefs(project);
  if (!refs.length) return;
  const x0 = refs.map(r => Math.log(r.el[r.key]));
  const lo = x0.map(v => v - Math.log(8)), hi = x0.map(v => v + Math.log(8));
  const apply = x => refs.forEach((r, i) => { r.el[r.key] = Math.exp(Math.min(hi[i], Math.max(lo[i], x[i]))); });
  const f = x => { apply(x); return costFn(project, prepared, grid, opt); };
  const n = refs.length;
  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += 0.25; simplex.push(x); }
  let fv = simplex.map(f);
  for (let it = 0; it < opt.iters; it++) {
    const idx = fv.map((v, i) => i).sort((a, b) => fv[a] - fv[b]);
    simplex = idx.map(i => simplex[i]); fv = idx.map(i => fv[i]);
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += simplex[i][j] / n;
    const worst = simplex[n];
    const pt = t => c.map((v, j) => v + t * (worst[j] - v));
    const xr = pt(-1), fr = f(xr);
    if (fr < fv[0]) {
      const xe = pt(-2), fe = f(xe);
      if (fe < fr) { simplex[n] = xe; fv[n] = fe; } else { simplex[n] = xr; fv[n] = fr; }
    } else if (fr < fv[n - 1]) { simplex[n] = xr; fv[n] = fr; }
    else {
      const xc = fr < fv[n] ? pt(-0.5) : pt(0.5), fc = f(xc);
      if (fc < Math.min(fr, fv[n])) { simplex[n] = xc; fv[n] = fc; }
      else {
        for (let i = 1; i <= n; i++) { simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j])); fv[i] = f(simplex[i]); }
      }
    }
    const bi = fv.indexOf(Math.min(...fv));
    apply(simplex[bi]);
    yield { iter: it + 1, cost: fv[bi] };
    if (Math.abs(fv[n] - fv[0]) < 1e-5 && it > 50) break;
  }
  const bi = fv.indexOf(Math.min(...fv));
  apply(simplex[bi]);
  for (const r of refs) r.el[r.key] = +r.el[r.key].toPrecision(3);
}
