import test from 'node:test';
import assert from 'node:assert/strict';
import { minimumPhase } from '../js/dsp.js';
import * as M from '../js/model.js';
import { parseFRD, parseZMA, toFRD } from '../js/parse.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const idx = (grid, f) => { let k = 0; while (grid[k] < f) k++; return k; };

test('minimum phase of a 2nd-order high-pass matches analytic phase', () => {
  const f = M.logGrid(5, 40000, 800), fc = 100;
  const db = Array.from(f, x => { const s = x / fc; return -10 * Math.log10(1 + s ** -4); });
  const grid = M.logGrid(50, 10000, 50);
  const ph = minimumPhase(Array.from(f), db, grid);
  for (let i = 0; i < grid.length; i++) {
    const s = grid[i] / fc;
    const exact = Math.PI - Math.atan2(Math.SQRT2 * s, 1 - s * s); // Butterworth HP phase
    near(ph[i], exact, 0.05, `phase at ${grid[i].toFixed(0)} Hz`);
  }
});

test('T/S model: free-air impedance peak at Fs with Re+Res', () => {
  const ts = { fs: 40, re: 6, le: 0, qms: 4, qes: 0.4, sens: 87, box: 'ib' };
  const grid = M.logGrid(10, 1000, 2001);
  const { Z, H } = M.tsSimulate(ts, grid);
  let kMax = 0;
  for (let k = 0; k < grid.length; k++) if (M.mag(Z, k) > M.mag(Z, kMax)) kMax = k;
  near(grid[kMax], 40, 0.5, 'Fs');
  near(M.mag(Z, kMax), 6 + 6 * 4 / 0.4, 0.5, 'Zmax');
  near(M.toDb(H, grid.length - 1), 87, 0.1, 'passband SPL');
});

test('T/S model: sealed box gives Fc = Fs*sqrt(1+a)', () => {
  const ts = { fs: 40, re: 6, le: 0, qms: 4, qes: 0.4, vas: 30, vb: 10, sens: 87, box: 'sealed' };
  const grid = M.logGrid(10, 1000, 4001);
  const { Z } = M.tsSimulate(ts, grid);
  let kMax = 0;
  for (let k = 0; k < grid.length; k++) if (M.mag(Z, k) > M.mag(Z, kMax)) kMax = k;
  near(grid[kMax], 80, 0.6, 'Fc');
});

test('T/S model: vented box impedance minimum at Fb', () => {
  const ts = { fs: 40, re: 6, le: 0, qms: 4, qes: 0.4, vas: 30, vb: 30, fb: 38, sens: 87, box: 'vented' };
  const grid = M.logGrid(15, 80, 3001);
  const { Z, H } = M.tsSimulate(ts, grid);
  let kMin = 0;
  for (let k = 0; k < grid.length; k++) if (M.mag(Z, k) < M.mag(Z, kMin)) kMin = k;
  near(grid[kMin], 38, 0.5, 'Fb');
  assert.ok(isFinite(M.toDb(H, kMin)));
});

test('LR2 crossover on resistive drivers sums flat with tweeter inverted', () => {
  const grid = M.logGrid(100, 20000, 200);
  const flat = () => {
    const n = grid.length;
    const H = { re: new Float64Array(n).fill(10 ** (85 / 20)), im: new Float64Array(n) };
    const Z = { re: new Float64Array(n).fill(8), im: new Float64Array(n) };
    return { H, Z };
  };
  const p = [flat(), flat()];
  const mk = (type) => ({ enabled: true, ts: {}, design: { type, fc: 2000, align: 'lr2', pad: 0, zobel: false }, network: [], invert: type === 'hp' });
  const project = { drivers: [mk('lp'), mk('hp')] };
  project.drivers.forEach((d, i) => { d.network = M.designNetwork(d, p[i], grid); d.network.forEach(e => { if (e.kind === 'L') e.rL = 0; }); });
  const res = M.simulate(project, p, grid);
  for (let k = 0; k < grid.length; k++) near(M.toDb(res.sum, k), 85, 0.1, `sum at ${grid[k].toFixed(0)}`);
  near(M.toDb(res.drivers[0].H, idx(grid, 2000)), 79, 0.2, 'LP -6 dB at fc');
});

test('LR4 crossover sums flat in phase', () => {
  const grid = M.logGrid(100, 20000, 200);
  const flat = () => {
    const n = grid.length;
    return { H: { re: new Float64Array(n).fill(1), im: new Float64Array(n) }, Z: { re: new Float64Array(n).fill(8), im: new Float64Array(n) } };
  };
  const p = [flat(), flat()];
  const mk = (type) => ({ enabled: true, ts: {}, design: { type, fc: 2000, align: 'lr4', pad: 0, zobel: false }, network: [] });
  const project = { drivers: [mk('lp'), mk('hp')] };
  project.drivers.forEach((d, i) => { d.network = M.designNetwork(d, p[i], grid); d.network.forEach(e => { if (e.kind === 'L') e.rL = 0; }); });
  const res = M.simulate(project, p, grid);
  for (let k = 0; k < grid.length; k++) near(M.toDb(res.sum, k), 0, 0.1, `sum at ${grid[k].toFixed(0)}`);
});

test('L-pad attenuates by the requested amount on a resistive load', () => {
  const { rs, rp } = M.lpadValues(8, 6);
  const net = [M.makeElement('series', 'R', { R: rs }), M.makeElement('shunt', 'R', { R: rp })];
  const r = M.ladder(net, 8, 0, 1000);
  near(20 * Math.log10(Math.hypot(r.tr, r.ti)), -6, 0.01, 'attenuation');
  near(r.zr, 8, 0.01, 'input impedance');
});

test('FRD/ZMA parse handles comments, commas and missing phase', () => {
  const frd = parseFRD('* header\nFreq dB\n100, 85.0, -10\n200 86 -20\n300;87;-30\n');
  assert.deepEqual(frd.f, [100, 200, 300]);
  assert.deepEqual(frd.ph, [-10, -20, -30]);
  const z = parseZMA('10\t6.5\n20\t7.1\n40\t30\n');
  assert.equal(z.ph, null);
  const decimalComma = parseFRD('100\t85,5\n200\t86,5\n300\t87,5\n');
  assert.deepEqual(decimalComma.db, [85.5, 86.5, 87.5]);
  const grid = M.logGrid(20, 20000, 10);
  const txt = toFRD('t', grid, { re: new Float64Array(10).fill(1), im: new Float64Array(10) });
  assert.equal(parseFRD(txt).f.length, 10);
});

test('optimizer reduces the error', () => {
  const grid = M.logGrid(100, 20000, 60);
  const n = grid.length;
  const flat = () => ({ H: { re: new Float64Array(n).fill(10 ** (85 / 20)), im: new Float64Array(n) }, Z: { re: new Float64Array(n).fill(8), im: new Float64Array(n) } });
  const p = [flat(), flat()];
  const mk = (type, fc) => ({ enabled: true, ts: {}, design: { type, fc, align: 'lr2', pad: 0, zobel: false }, network: [], invert: type === 'hp' });
  const project = { drivers: [mk('lp', 1200), mk('hp', 3500)] };
  project.drivers.forEach((d, i) => { d.network = M.designNetwork(d, p[i], grid); });
  const opt = { lo: 200, hi: 15000, level: 85, zmin: 0, iters: 400 };
  const before = M.costFn(project, p, grid, opt);
  for (const _ of M.optimizer(project, p, grid, opt)) { /* run */ }
  const after = M.costFn(project, p, grid, opt);
  assert.ok(after < before * 0.5, `cost ${before} -> ${after}`);
});

test('roundE picks nearest standard value', () => {
  assert.equal(M.roundE(4.5), 4.7);
  assert.equal(M.roundE(0.53), 0.56);
  assert.equal(M.roundE(9.6), 10);
  assert.equal(M.roundE(3.05, 'E24'), 3.0);
});
