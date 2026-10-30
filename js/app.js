import * as M from './model.js';
import { Chart } from './chart.js';
import { parseFRD, parseZMA, readZip, isZip, toFRD, toZMA, guessKind, isDataFile } from './parse.js';
import { LIBRARY, TS_KEYS, SOURCES, findLinks } from './drivers.js';
import * as S from './store.js';

// ------------------------------------------------------------------ helpers

const $ = (s, r = document) => r.querySelector(s);
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'value') { value = v; continue; }
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open') e[k] = !!v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(3)) if (kid != null && kid !== false) e.append(kid instanceof Node ? kid : String(kid));
  if (value !== undefined) e.value = value;
  return e;
}
const fmt = (v, d = 3) => (v > 0 || v < 0 ? +(+v).toPrecision(d) + '' : '0');
const fmtHz = f => (f >= 1000 ? +(f / 1000).toPrecision(3) + ' kHz' : Math.round(f) + ' Hz');
const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#c026d3'];
const ROLE_LABEL = { woofer: 'Woofer', mid: 'Midrange', tweeter: 'Tweeter', other: 'Other' };
const GRID = M.logGrid(20, 20000, 360);

let toastTimer;
function toast(msg, isError) {
  const t = $('#toast');
  t.textContent = msg;
  t.style.background = isError ? 'var(--danger)' : '';
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 5000 : 2500);
}
function showModal(title, body) {
  $('#modalBody').replaceChildren(h('h3', {}, title), body);
  $('#modal').showModal();
}
const closeModal = () => $('#modal').close();

// ------------------------------------------------------------------ project model

function libToTs(lib) {
  const ts = {};
  for (const k of TS_KEYS) if (lib && lib[k] != null) ts[k] = lib[k];
  return ts;
}

function defaultDesign(role) {
  if (role === 'tweeter') return { type: 'hp', fc: 2200, align: 'lr2', pad: 5, zobel: false };
  if (role === 'mid') return { type: 'bp', fc: 3000, fc2: 500, align: 'lr2', align2: 'lr2', pad: 0, zobel: true };
  return { type: 'lp', fc: 2200, align: 'lr2', pad: 0, zobel: true };
}

function newDriver(role, libId) {
  const lib = LIBRARY.find(l => l.id === libId);
  const d = {
    id: M.newId(), name: lib ? `${lib.brand} ${lib.model}` : ROLE_LABEL[role], role, enabled: true, libId: lib ? lib.id : '',
    ts: { fs: 50, re: 6, le: 0.4, qms: 3, qes: 0.45, vas: 15, sens: 87, ...libToTs(lib), box: 'ib', vb: 0, fb: 0, baffle: 200 },
    frd: null, zma: null, phaseMode: 'file', offset: 0, invert: role === 'tweeter', gain: 0,
    design: defaultDesign(role), network: [],
  };
  if (role !== 'tweeter') Object.assign(d.ts, { box: 'sealed' }, M.suggestBox(d.ts, 'sealed'));
  return d;
}

function defaultProject() {
  const p = {
    version: 1, name: 'My 2-way speaker',
    drivers: [newDriver('woofer', 'sb-sb17nrx2c35-8'), newDriver('tweeter', 'sb-sb26stac-4')],
    opt: { lo: 200, hi: 15000, level: null, zmin: 3.2, iters: 1500, round: true },
  };
  p.drivers.forEach(d => { d.network = M.designNetwork(d, M.prepareDriver(d, GRID), GRID); });
  return p;
}

function normalize(p) {
  if (!p || !Array.isArray(p.drivers) || !p.drivers.length) throw new Error('Not a crossover project');
  p.opt = { lo: 200, hi: 15000, level: null, zmin: 3.2, iters: 1500, round: true, ...(p.opt || {}) };
  p.name = p.name || 'Untitled';
  for (const d of p.drivers) {
    d.id = d.id || M.newId();
    d.ts = d.ts || {};
    d.design = { ...defaultDesign(d.role || 'woofer'), ...(d.design || {}) };
    d.network = (d.network || []).filter(el => M.KINDS[el.kind]).map(el => ({ id: el.id || M.newId(), ...el }));
    d.enabled = d.enabled !== false;
    d.phaseMode = d.phaseMode || 'file';
  }
  return p;
}

let project;
const cache = new Map();
let prepared = [];
let result = null;
let chartType = 'spl';
let activeTab = 'drivers';
const undoStack = [];

function driverKey(d) {
  return JSON.stringify([d.ts, d.phaseMode, d.frd && d.frd.stamp, d.zma && d.zma.stamp]);
}

function compute() {
  prepared = project.drivers.map(d => {
    const key = driverKey(d);
    let c = cache.get(d.id);
    if (!c || c.key !== key) { c = { key, p: M.prepareDriver(d, GRID) }; cache.set(d.id, c); }
    return c.p;
  });
  result = M.simulate(project, prepared, GRID);
}

let raf = 0;
function recalc() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    compute();
    drawChart();
    renderSummary();
    saveSoon();
  });
}

let saveTimer;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => S.saveLocal(project), 600);
}

function pushUndo() {
  undoStack.push(JSON.stringify(project.drivers.map(d => d.network)));
  if (undoStack.length > 30) undoStack.shift();
}
function undo() {
  const s = undoStack.pop();
  if (!s) return toast('Nothing to undo');
  const nets = JSON.parse(s);
  project.drivers.forEach((d, i) => { if (nets[i]) d.network = nets[i]; });
  renderCrossover(); recalc(); toast('Undone');
}

// ------------------------------------------------------------------ chart

const chart = new Chart($('#chart'), $('#readout'));

function dbArr(c, gain = 0) { return Array.from(GRID, (_, k) => M.toDb(c, k) + gain); }
function degArr(c) { return Array.from(GRID, (_, k) => M.toDeg(c, k)); }

function drawChart() {
  if (!result) return;
  const series = [];
  const on = project.drivers.map((d, i) => ({ d, i })).filter(x => x.d.enabled);
  const showRaw = $('#showRaw').checked;
  const cfg = { xmin: 20, xmax: 20000, series, bands: [], hlines: [] };
  if (chartType === 'spl') {
    let max = -Infinity;
    if (showRaw) for (const { d, i } of on) series.push({ name: d.name + ' raw', x: GRID, y: dbArr(prepared[i].H, +d.gain || 0), color: COLORS[i % 4], width: 1, dash: [4, 3], alpha: 0.6, noReadout: true });
    for (const { d, i } of on) {
      const y = dbArr(result.drivers[i].H);
      series.push({ name: shortName(d), x: GRID, y, color: COLORS[i % 4], unit: ' dB' });
      max = Math.max(max, ...y);
    }
    const sum = dbArr(result.sum);
    max = Math.max(max, ...sum);
    series.push({ name: 'Sum', x: GRID, y: sum, color: 'fg', width: 2.4, unit: ' dB' });
    const top = Math.ceil((max + 4) / 5) * 5;
    cfg.y = { min: top - 50, max: top, step: 5, label: 'dB SPL @ 2.83 V/1 m' };
    if (activeTab === 'optimize') {
      const L = targetLevel();
      cfg.bands.push({ x0: project.opt.lo, x1: project.opt.hi, y0: L - 1.5, y1: L + 1.5, color: 'rgba(37,99,235,0.12)' });
      cfg.hlines.push({ y: L, x0: project.opt.lo, x1: project.opt.hi, color: 'rgba(37,99,235,0.7)' });
    }
  } else if (chartType === 'phase') {
    for (const { d, i } of on) series.push({ name: shortName(d), x: GRID, y: degArr(result.drivers[i].H), color: COLORS[i % 4], wrap: true, unit: '°', digits: 0 });
    series.push({ name: 'Sum', x: GRID, y: degArr(result.sum), color: 'fg', width: 2.2, wrap: true, unit: '°', digits: 0 });
    cfg.y = { min: -180, max: 180, step: 45, label: 'Phase (°)' };
  } else if (chartType === 'imp') {
    const zm = Array.from(GRID, (_, k) => M.mag(result.Z, k));
    if (showRaw) for (const { d, i } of on) series.push({ name: shortName(d) + ' |Z|', x: GRID, y: Array.from(GRID, (_, k) => M.mag(prepared[i].Z, k)), color: COLORS[i % 4], width: 1, dash: [4, 3], alpha: 0.7, unit: ' Ω' });
    series.push({ name: 'Phase', x: GRID, y: degArr(result.Z), color: '#94a3b8', axis: 'y2', dash: [5, 3], unit: '°', digits: 0 });
    series.push({ name: '|Z|', x: GRID, y: zm, color: 'fg', width: 2.4, unit: ' Ω' });
    const zmax = Math.min(80, Math.max(16, Math.ceil(Math.max(...zm) / 4) * 4));
    cfg.y = { min: 0, max: zmax, label: 'Impedance (Ω)' };
    cfg.y2 = { min: -90, max: 90, step: 30, label: 'Phase (°)' };
  } else {
    const gd = M.groupDelay(result.sum, GRID);
    let mx = 1;
    for (let k = 0; k < GRID.length; k++) if (GRID[k] > 60) mx = Math.max(mx, gd[k]);
    series.push({ name: 'Group delay', x: GRID, y: Array.from(gd), color: 'fg', width: 2.2, unit: ' ms', digits: 2 });
    cfg.y = { min: Math.min(0, Math.floor(Math.min(...gd.filter((_, k) => GRID[k] > 60)))), max: Math.min(30, Math.ceil(mx * 1.2)), label: 'Group delay (ms)' };
  }
  chart.set(cfg);
  $('#legend').replaceChildren(...on.map(({ d, i }) => h('span', {}, h('i', { style: `background:${COLORS[i % 4]}` }), d.name)), h('span', {}, h('i', { style: 'background:var(--text)' }), 'Sum'));
}

const shortName = d => (d.name.length > 14 ? ROLE_LABEL[d.role] || d.name.slice(0, 12) : d.name);

function targetLevel() {
  if (project.opt.level != null && isFinite(project.opt.level)) return +project.opt.level;
  return meanLevel();
}
function meanLevel() {
  let s = 0, n = 0;
  for (let k = 0; k < GRID.length; k++) if (GRID[k] >= project.opt.lo && GRID[k] <= project.opt.hi) { s += M.toDb(result.sum, k); n++; }
  return n ? Math.round(s / n * 10) / 10 : 85;
}

function renderSummary() {
  const { lo, hi } = project.opt;
  let mn = Infinity, mx = -Infinity, zmin = Infinity, fz = 0;
  for (let k = 0; k < GRID.length; k++) {
    const f = GRID[k];
    const z = M.mag(result.Z, k);
    if (z < zmin) { zmin = z; fz = f; }
    if (f < lo || f > hi) continue;
    const v = M.toDb(result.sum, k);
    mn = Math.min(mn, v); mx = Math.max(mx, v);
  }
  const stats = [
    h('span', { class: 'stat' }, `Level `, h('b', {}, meanLevel().toFixed(1) + ' dB')),
    h('span', { class: 'stat' + (mx - mn > 6 ? ' warn' : '') }, `Ripple ${fmtHz(lo)}–${fmtHz(hi)} `, h('b', {}, '±' + ((mx - mn) / 2).toFixed(1) + ' dB')),
    h('span', { class: 'stat' + (zmin < 3.2 ? ' warn' : '') }, `Min Z `, h('b', {}, zmin.toFixed(1) + ' Ω'), ` @ ${fmtHz(fz)}`),
  ];
  // crossover points between consecutive drivers (by role)
  const order = { woofer: 0, mid: 1, other: 1, tweeter: 2 };
  const on = project.drivers.map((d, i) => ({ d, i })).filter(x => x.d.enabled).sort((a, b) => order[a.d.role] - order[b.d.role]);
  for (let j = 0; j + 1 < on.length; j++) {
    const a = result.drivers[on[j].i].H, b = result.drivers[on[j + 1].i].H;
    let best = null;
    for (let k = 1; k < GRID.length; k++) {
      if (GRID[k] < 80 || GRID[k] > 16000) continue;
      const d0 = M.toDb(a, k - 1) - M.toDb(b, k - 1), d1 = M.toDb(a, k) - M.toDb(b, k);
      if (d0 >= 0 && d1 < 0) { const lv = M.toDb(a, k); if (!best || lv > best.lv) best = { f: GRID[k], lv }; }
    }
    if (best) stats.push(h('span', { class: 'stat' }, `Crossover `, h('b', {}, fmtHz(best.f))));
  }
  $('#summary').replaceChildren(...stats);
}

// ------------------------------------------------------------------ inputs

function num(label, obj, key, unit, opts = {}) {
  const inp = h('input', { type: 'number', inputmode: 'decimal', step: 'any', value: obj[key] ?? '', placeholder: opts.placeholder });
  inp.addEventListener('input', () => {
    if (inp.value === '' && opts.nullable) obj[key] = null;
    else {
      const v = parseFloat(inp.value);
      if (!isFinite(v)) return;
      obj[key] = v;
    }
    opts.onInput && opts.onInput();
    recalc();
  });
  if (opts.onChange) inp.addEventListener('change', opts.onChange);
  return h('label', { class: 'field' }, h('span', {}, label, unit ? h('span', { class: 'u' }, ` ${unit}`) : null), inp);
}

function select(options, value, onchange, props = {}) {
  return h('select', { ...props, value, onchange: e => onchange(e.target.value) },
    options.map(o => (o.group
      ? h('optgroup', { label: o.group }, o.options.map(x => h('option', { value: x.value }, x.label)))
      : h('option', { value: o.value }, o.label))));
}

// ------------------------------------------------------------------ drivers tab

function renderDrivers() {
  const root = $('#tab-drivers');
  root.replaceChildren(...project.drivers.map(driverCard));
  if (project.drivers.length < 4) {
    root.append(h('div', { class: 'card' },
      h('h3', {}, 'Add a driver'),
      h('div', { class: 'row' },
        h('button', { onclick: () => addDriver('mid', 'dayton-rs100-8') }, '+ Midrange'),
        h('button', { onclick: () => addDriver('woofer', 'dayton-rs180-8') }, '+ Woofer'),
        h('button', { onclick: () => addDriver('tweeter', 'dayton-nd25fa-4') }, '+ Tweeter'))));
  }
  root.append(h('p', { class: 'note' }, 'Library values are approximate datasheet figures for a quick start. For an accurate design load the manufacturer’s FRD/ZMA files or your own measurements.'));
}

function addDriver(role, libId) {
  const d = newDriver(role, libId);
  d.network = M.designNetwork(d, M.prepareDriver(d, GRID), GRID);
  project.drivers.push(d);
  renderAll(); recalc();
}

function libraryOptions() {
  const groups = [['woofer', 'Woofers'], ['mid', 'Midrange'], ['tweeter', 'Tweeters']].map(([t, g]) => ({
    group: g, options: LIBRARY.filter(l => l.type === t).map(l => ({ value: l.id, label: `${l.brand} ${l.model} (${l.size})` })),
  }));
  const user = S.userLibrary();
  if (user.length) groups.push({ group: 'My library', options: user.map(u => ({ value: 'user:' + u.id, label: u.name + (u.frd ? ' • FRD' : '') + (u.zma ? ' • ZMA' : '') })) });
  return [{ value: '', label: '— choose from library —' }, ...groups];
}

function applyLibrary(d, val) {
  if (!val) return;
  if (val.startsWith('user:')) {
    const u = S.userLibrary().find(x => 'user:' + x.id === val);
    if (!u) return;
    d.name = u.name; d.ts = { ...u.ts }; d.frd = u.frd || null; d.zma = u.zma || null; d.libId = val;
  } else {
    const lib = LIBRARY.find(l => l.id === val);
    const keep = { box: d.ts.box, vb: d.ts.vb, fb: d.ts.fb, baffle: d.ts.baffle };
    d.ts = { ...libToTs(lib), ...keep };
    d.name = `${lib.brand} ${lib.model}`; d.libId = lib.id; d.frd = null; d.zma = null;
    if (d.ts.box === 'sealed' || d.ts.box === 'vented') Object.assign(d.ts, M.suggestBox(d.ts, d.ts.box));
  }
  renderAll(); recalc();
  toast(`Loaded ${d.name}`);
}

function driverCard(d, i) {
  const ts = d.ts;
  const qtsOut = h('span', { class: 'badge' });
  const boxInfo = h('span', { class: 'note' });
  const updInfo = () => {
    const q = M.qts(ts);
    qtsOut.textContent = 'Qts ' + (isFinite(q) ? q.toFixed(2) : '–');
    if (ts.box === 'sealed' && ts.vb > 0 && ts.vas > 0) {
      const a = M.sealedAlignment(ts);
      boxInfo.textContent = `Box resonance ${a.fc.toFixed(0)} Hz, Qtc ${a.qtc.toFixed(2)}`;
    } else if (ts.box === 'vented') boxInfo.textContent = ts.vb > 0 && ts.fb > 0 ? `Tuned to ${ts.fb} Hz` : 'Enter box volume and tuning';
    else boxInfo.textContent = ts.baffle > 0 ? 'Baffle step included' : '';
  };
  updInfo();
  const lib = LIBRARY.find(l => l.id === d.libId);
  const links = findLinks(lib ? lib.brand : '', lib ? lib.model : d.name);
  if (lib && lib.site) links.unshift({ name: lib.brand + ' website', url: lib.site });
  const hasFrd = !!d.frd, hasZma = !!d.zma;
  const tsFields = [
    ['Fs', 'fs', 'Hz'], ['Re', 're', 'Ω'], ['Le', 'le', 'mH'], ['Qms', 'qms', ''], ['Qes', 'qes', ''],
    ['Vas', 'vas', 'L'], ['Sensitivity', 'sens', 'dB'], ['Sd', 'sd', 'cm²'], ['Xmax', 'xmax', 'mm'],
  ];
  const card = h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('span', { class: 'dot', style: `background:${COLORS[i % 4]}` }),
      h('input', { class: 'name', value: d.name, 'aria-label': 'Driver name', oninput: e => { d.name = e.target.value; drawChart(); saveSoon(); }, onchange: () => renderCrossover() }),
      h('label', { class: 'chk small', title: 'Include in simulation' }, h('input', { type: 'checkbox', checked: d.enabled, onchange: e => { d.enabled = e.target.checked; recalc(); } }), 'on'),
      project.drivers.length > 1 ? h('button', { class: 'ghost danger icon', title: 'Remove driver', 'aria-label': 'Remove driver', onclick: () => { if (confirm(`Remove ${d.name}?`)) { project.drivers.splice(i, 1); renderAll(); recalc(); } } }, '✕') : null),
    h('div', { class: 'row' },
      select(Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label })), d.role, v => { d.role = v; renderSummary(); saveSoon(); }, { 'aria-label': 'Role' }),
      select(libraryOptions(), d.libId || '', v => applyLibrary(d, v), { class: 'grow', 'aria-label': 'Driver library' })),
    h('div', { class: 'row' },
      h('span', { class: 'badge ' + (hasFrd ? 'ok' : '') }, hasFrd ? 'Response: FRD file' : 'Response: T/S simulation'),
      h('span', { class: 'badge ' + (hasZma ? 'ok' : '') }, hasZma ? 'Impedance: ZMA file' : 'Impedance: T/S simulation'),
      qtsOut),

    h('details', { open: !hasFrd || !hasZma },
      h('summary', {}, 'Thiele/Small parameters'),
      h('div', { class: 'grid' }, tsFields.map(([l, k, u]) => num(l, ts, k, u, { onInput: updInfo }))),
      h('p', { class: 'note' }, 'Sensitivity is dB SPL at 2.83 V / 1 m. Sd and Xmax are for reference only.'),
      h('h4', {}, 'Enclosure & baffle'),
      h('div', { class: 'grid' },
        h('label', { class: 'field' }, h('span', {}, 'Box'), select([
          { value: 'ib', label: 'Infinite baffle / closed back' }, { value: 'sealed', label: 'Sealed' }, { value: 'vented', label: 'Vented (bass reflex)' },
        ], ts.box || 'ib', v => { ts.box = v; if (v !== 'ib' && !(ts.vb > 0)) Object.assign(ts, M.suggestBox(ts, v)); renderDrivers(); recalc(); })),
        ts.box !== 'ib' ? num('Volume', ts, 'vb', 'L', { onInput: updInfo }) : null,
        ts.box === 'vented' ? num('Tuning', ts, 'fb', 'Hz', { onInput: updInfo }) : null,
        num('Baffle width', ts, 'baffle', 'mm', { onInput: updInfo })),
      h('div', { class: 'row' }, boxInfo, ts.box !== 'ib' ? h('button', { class: 'small', onclick: () => { Object.assign(ts, M.suggestBox(ts, ts.box)); renderDrivers(); recalc(); } }, 'Suggest box') : null),
      h('p', { class: 'note' }, 'Baffle width adds a simple baffle-step (−6 dB in the bass). Set 0 to turn it off. Applies to the T/S simulation only — measured FRD files already include it.')),

    h('details', { open: true },
      h('summary', {}, 'Measurement files (FRD / ZMA)'),
      h('div', { class: 'files' }, fileSlot(d, 'frd'), fileSlot(d, 'zma')),
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('label', { class: 'field grow' }, h('span', {}, 'Phase of FRD'), select([
          { value: 'file', label: 'Use phase from file (if present)' }, { value: 'min', label: 'Minimum phase (calculated)' },
        ], d.phaseMode, v => { d.phaseMode = v; recalc(); }))),
      h('p', { class: 'note' }, 'Upload .frd/.zma/.txt files or the manufacturer’s .zip directly. Files without phase get minimum phase automatically.'),
      h('div', { class: 'links' }, h('span', { class: 'muted' }, 'Find data:'), links.map(l => h('a', { href: l.url, target: '_blank', rel: 'noopener' }, l.name)))),

    h('details', {},
      h('summary', {}, 'Placement & level'),
      h('div', { class: 'grid' },
        num('Acoustic offset', d, 'offset', 'mm'),
        num('Level trim', d, 'gain', 'dB'),
        h('label', { class: 'chk', style: 'margin-top:18px' }, h('input', { type: 'checkbox', checked: d.invert, onchange: e => { d.invert = e.target.checked; recalc(); } }), 'Invert polarity')),
      h('p', { class: 'note' }, 'Offset: how far the driver’s acoustic centre sits behind the reference (positive = further back, adds delay). A woofer is typically 10–30 mm behind a dome tweeter when the FRD has no timing.')),

    h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { class: 'small', onclick: () => saveToLibrary(d) }, '★ Save to my library'),
      tsValidBtn(d)));
  return card;
}

function tsValidBtn(d) {
  if (!M.tsValid(d.ts)) return null;
  return h('button', { class: 'small', onclick: () => exportTs(d) }, '⬇ T/S model as FRD + ZMA');
}

function exportTs(d) {
  const g = M.logGrid(10, 40000, 500);
  const sim = M.tsSimulate(d.ts, g);
  const base = safeName(d.name);
  S.download(base + '_sim.frd', toFRD(`${d.name} — simulated from T/S (${d.ts.box})`, g, sim.H));
  setTimeout(() => S.download(base + '_sim.zma', toZMA(`${d.name} — simulated from T/S (${d.ts.box})`, g, sim.Z)), 400);
}

function saveToLibrary(d) {
  const list = S.userLibrary();
  const entry = { id: M.newId(), name: d.name, ts: { ...d.ts }, frd: d.frd, zma: d.zma };
  const idx = list.findIndex(x => x.name === d.name);
  if (idx >= 0) { entry.id = list[idx].id; list[idx] = entry; } else list.push(entry);
  try { S.saveUserLibrary(list); d.libId = 'user:' + entry.id; renderDrivers(); toast('Saved to My library'); }
  catch (e) { toast(e.message, true); }
}

function fileSlot(d, kind) {
  const data = d[kind];
  const label = data ? `${data.name} · ${data.f.length} pts${!data.ph ? ' · no phase' : ''}` : 'none — using T/S model';
  const slot = h('div', { class: 'file-slot' },
    h('span', { class: 'lbl' }, kind.toUpperCase()),
    h('span', { class: 'fname', title: label }, label),
    h('button', { class: 'small', onclick: async () => { const f = await S.pickFile(); if (f) handleFile(d, kind, f); } }, 'Upload'),
    h('button', { class: 'small', onclick: () => loadUrl(d, kind) }, 'URL'),
    data ? h('button', { class: 'ghost danger icon', 'aria-label': 'Remove file', onclick: () => { d[kind] = null; renderDrivers(); recalc(); } }, '✕') : null);
  slot.addEventListener('dragover', e => { e.preventDefault(); slot.classList.add('drag'); });
  slot.addEventListener('dragleave', () => slot.classList.remove('drag'));
  slot.addEventListener('drop', e => { e.preventDefault(); slot.classList.remove('drag'); const f = e.dataTransfer.files[0]; if (f) handleFile(d, kind, f); });
  return slot;
}

async function handleFile(d, kind, file) {
  try { await handleBuffer(d, kind, await file.arrayBuffer(), file.name); }
  catch (e) { toast(e.message, true); }
}

async function handleBuffer(d, kind, buf, name) {
  if (isZip(buf)) {
    const entries = readZip(buf).filter(e => isDataFile(e.name));
    if (!entries.length) throw new Error('No .frd/.zma/.txt files found in the ZIP');
    const frds = entries.filter(e => guessKind(e.name) === 'frd'), zmas = entries.filter(e => guessKind(e.name) === 'zma');
    if (frds.length === 1 && zmas.length <= 1 && frds.length + zmas.length === entries.length) {
      loadText(d, 'frd', await frds[0].text(), base(frds[0].name), true);
      if (zmas[0]) loadText(d, 'zma', await zmas[0].text(), base(zmas[0].name), true);
      renderDrivers(); recalc();
      toast(`Loaded ${[frds[0], zmas[0]].filter(Boolean).map(e => base(e.name)).join(' + ')}`);
      return;
    }
    return zipPicker(d, entries, name);
  }
  loadText(d, kind, new TextDecoder().decode(buf), name);
}

const base = n => n.split('/').pop();

function loadText(d, kind, text, name, quiet) {
  try {
    d[kind] = kind === 'frd' ? parseFRD(text, name) : parseZMA(text, name);
    if (!quiet) { toast(`Loaded ${name}`); renderDrivers(); recalc(); }
  } catch (e) { toast(`${name}: ${e.message}`, true); }
}

function zipPicker(d, entries, zipName) {
  const list = h('div', {}, h('p', { class: 'note' }, `Choose files from ${zipName} for ${d.name}.`),
    entries.map(e => {
      const g = guessKind(e.name);
      return h('div', { class: 'zip-item' }, h('span', { class: 'zn' }, e.name),
        h('button', { class: g === 'frd' ? 'primary small' : 'small', onclick: async ev => { ev.preventDefault(); loadText(d, 'frd', await e.text(), base(e.name)); } }, 'Use as FRD'),
        h('button', { class: g === 'zma' ? 'primary small' : 'small', onclick: async ev => { ev.preventDefault(); loadText(d, 'zma', await e.text(), base(e.name)); } }, 'Use as ZMA'));
    }));
  showModal('Files in ZIP', list);
}

async function loadUrl(d, kind) {
  const url = prompt('Paste a direct link to an .frd, .zma or .zip file:');
  if (!url) return;
  try {
    const r = await fetch(url.trim());
    if (!r.ok) throw new Error('HTTP ' + r.status);
    await handleBuffer(d, kind, await r.arrayBuffer(), decodeURIComponent(base(new URL(url).pathname)) || kind);
  } catch (e) {
    toast('Could not download that file — many sites block direct downloads from other websites. Save it to your device and use Upload instead.', true);
  }
}

// ------------------------------------------------------------------ crossover tab

function fmtEl(el) {
  const v = k => `${fmt(el[k])}${M.UNITS[k]}`;
  switch (el.kind) {
    case 'R': return `R ${v('R')}`;
    case 'L': return `L ${fmt(el.L)} mH`;
    case 'C': return `C ${fmt(el.C)} µF`;
    case 'RC': return `R ${v('R')} + C ${fmt(el.C)} µF`;
    case 'RLC': return `R ${v('R')} + L ${fmt(el.L)} mH + C ${fmt(el.C)} µF`;
    case 'RLCp': return `(${el.R > 0 ? 'R ' + v('R') + ' ‖ ' : ''}L ${fmt(el.L)} mH ‖ C ${fmt(el.C)} µF)`;
  }
  return el.kind;
}

function renderCrossover() {
  const root = $('#tab-crossover');
  root.replaceChildren(
    h('div', { class: 'row' },
      h('p', { class: 'note grow', style: 'margin:0' }, 'Parts are listed from the amplifier (top) to the driver (bottom). Use − / + to nudge values 5% and watch the graph.'),
      h('button', { class: 'small', onclick: undo }, '↶ Undo')),
    ...project.drivers.map(xoverCard));
}

function xoverCard(d, i) {
  const ds = d.design;
  const alignOpts = Object.entries(M.ALIGNMENTS).map(([value, a]) => ({ value, label: a.label }));
  const els = h('div', {});
  const redraw = () => { renderCrossover(); recalc(); };
  d.network.forEach((el, j) => els.append(elementRow(d, el, j, redraw)));
  if (!d.network.length) els.append(h('p', { class: 'note' }, 'No parts — the driver is connected straight to the amplifier.'));
  const add = (pos, kind, vals) => () => { pushUndo(); d.network.push(M.makeElement(pos, kind, vals)); redraw(); };
  const zobel = () => {
    const { re, le } = M.estimateReLe(d, prepared[i], GRID);
    if (!(le > 0)) return toast('Could not estimate Le for a Zobel', true);
    const R = 1.25 * re;
    return { R: +R.toPrecision(2), C: +(le / (R * R) * 1e6).toPrecision(2) };
  };
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('span', { class: 'dot', style: `background:${COLORS[i % 4]}` }),
      h('span', { class: 'name' }, d.name),
      h('label', { class: 'chk small' }, h('input', { type: 'checkbox', checked: d.invert, onchange: e => { d.invert = e.target.checked; recalc(); } }), 'invert')),
    h('details', { open: !d.network.length },
      h('summary', {}, 'Quick design'),
      h('div', { class: 'grid' },
        h('label', { class: 'field' }, h('span', {}, 'Filter'), select([
          { value: 'lp', label: 'Low-pass' }, { value: 'hp', label: 'High-pass' }, { value: 'bp', label: 'Band-pass' }, { value: 'none', label: 'None' },
        ], ds.type, v => { ds.type = v; if (v === 'bp' && !ds.fc2) ds.fc2 = 500; renderCrossover(); saveSoon(); })),
        ds.type !== 'none' ? num(ds.type === 'bp' ? 'Low-pass at' : 'Frequency', ds, 'fc', 'Hz') : null,
        ds.type !== 'none' ? h('label', { class: 'field' }, h('span', {}, 'Slope'), select(alignOpts, ds.align, v => { ds.align = v; saveSoon(); })) : null,
        ds.type === 'bp' ? num('High-pass at', ds, 'fc2', 'Hz') : null,
        ds.type === 'bp' ? h('label', { class: 'field' }, h('span', {}, 'HP slope'), select(alignOpts, ds.align2 || ds.align, v => { ds.align2 = v; saveSoon(); })) : null,
        num('L-pad', ds, 'pad', 'dB'),
        h('label', { class: 'chk', style: 'margin-top:18px' }, h('input', { type: 'checkbox', checked: ds.zobel, onchange: e => { ds.zobel = e.target.checked; saveSoon(); } }), 'Zobel')),
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'primary', onclick: () => { pushUndo(); d.network = M.designNetwork(d, prepared[i], GRID); redraw(); toast('Network designed — fine-tune or optimise next'); } }, 'Design network'),
        h('span', { class: 'note' }, 'Replaces the parts below with textbook values.'))),
    h('div', { class: 'schematic' }, h('span', { class: 'amp' }, 'AMP'),
      d.network.filter(el => !el.off).map(el => [' → ', h('span', {}, el.pos === 'series' ? '' : '⏚ ', fmtEl(el))]), ' → ', h('span', { class: 'drv' }, '🔊')),
    els,
    h('div', { class: 'add-row' },
      h('button', { onclick: add('series', 'L') }, '+ Series L'),
      h('button', { onclick: add('series', 'C') }, '+ Series C'),
      h('button', { onclick: add('series', 'R') }, '+ Series R'),
      h('button', { onclick: add('shunt', 'C') }, '+ Shunt C'),
      h('button', { onclick: add('shunt', 'L') }, '+ Shunt L'),
      h('button', { onclick: add('shunt', 'R') }, '+ Shunt R'),
      h('button', { onclick: () => { const z = zobel(); if (z) add('shunt', 'RC', z)(); } }, '+ Zobel'),
      h('button', { onclick: add('shunt', 'RLC', { R: 2, L: 0.3, C: 20 }) }, '+ Trap'),
      h('button', { onclick: add('series', 'RLCp', { R: 4, L: 0.3, C: 20 }) }, '+ Notch')));
}

function elementRow(d, el, j, redraw) {
  const net = d.network;
  const move = dir => () => { const k = j + dir; if (k < 0 || k >= net.length) return; pushUndo(); [net[j], net[k]] = [net[k], net[j]]; redraw(); };
  const vals = M.KINDS[el.kind].keys.map(key => valField(el, key));
  return h('div', { class: 'el' + (el.off ? ' off' : '') },
    h('div', { class: 'el-head' },
      h('span', { class: 'idx' }, j + 1),
      select([{ value: 'series', label: 'Series' }, { value: 'shunt', label: 'Shunt ⏚' }], el.pos, v => { el.pos = v; redraw(); }, { 'aria-label': 'Position' }),
      select(Object.entries(M.KINDS).map(([value, k]) => ({ value, label: k.label })), el.kind, v => {
        el.kind = v;
        for (const [k, dv] of Object.entries(M.DEFAULTS[v])) if (!(el[k] > 0)) el[k] = dv;
        redraw();
      }, { 'aria-label': 'Part type' }),
      h('span', { class: 'tools' },
        h('button', { class: 'ghost', title: el.off ? 'Enable part' : 'Bypass part', 'aria-label': 'Bypass', onclick: () => { el.off = !el.off; redraw(); } }, el.off ? '○' : '●'),
        h('button', { class: 'ghost', title: el.lock ? 'Locked — optimiser keeps this value' : 'Unlocked — optimiser may change this', 'aria-label': 'Lock', onclick: () => { el.lock = !el.lock; redraw(); } }, el.lock ? '🔒' : '🔓'),
        h('button', { class: 'ghost', 'aria-label': 'Move up', onclick: move(-1) }, '↑'),
        h('button', { class: 'ghost', 'aria-label': 'Move down', onclick: move(1) }, '↓'),
        h('button', { class: 'ghost danger', 'aria-label': 'Delete part', onclick: () => { pushUndo(); net.splice(j, 1); redraw(); } }, '✕'))),
    h('div', { class: 'vals' }, vals));
}

function valField(el, key) {
  const label = key === 'rL' ? 'DCR' : key;
  const inp = h('input', { type: 'number', inputmode: 'decimal', step: 'any', value: fmt(el[key] || 0, 4), 'aria-label': label });
  const sync = () => { inp.value = fmt(el[key] || 0, 4); refreshSchematics(); recalc(); };
  inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (isFinite(v) && v >= 0) { el[key] = v; refreshSchematics(); recalc(); } });
  const bump = k => () => { const v = el[key] || 0; el[key] = v > 0 ? +(v * k).toPrecision(3) : (k > 1 ? 0.1 : 0); sync(); };
  return h('div', { class: 'vf' },
    h('label', {}, label),
    h('button', { class: 'step', 'aria-label': 'Decrease', onclick: bump(1 / 1.05) }, '−'),
    inp,
    h('button', { class: 'step', 'aria-label': 'Increase', onclick: bump(1.05) }, '+'),
    h('span', { class: 'unit' }, M.UNITS[key]));
}

let schemTimer;
function refreshSchematics() {
  clearTimeout(schemTimer);
  schemTimer = setTimeout(() => {
    const cards = $('#tab-crossover').querySelectorAll('.card');
    project.drivers.forEach((d, i) => {
      const s = cards[i] && cards[i].querySelector('.schematic');
      if (!s) return;
      s.replaceChildren(h('span', { class: 'amp' }, 'AMP'), ...d.network.filter(el => !el.off).flatMap(el => [' → ', h('span', {}, el.pos === 'series' ? '' : '⏚ ', fmtEl(el))]), ' → ', h('span', { class: 'drv' }, '🔊'));
    });
  }, 150);
}

// ------------------------------------------------------------------ optimise tab

let optRun = null;

function renderOptimize() {
  const o = project.opt;
  const bar = h('div', {});
  const status = h('p', { class: 'note', id: 'optStatus' }, 'Adjusts all unlocked part values to make the summed response as flat as possible.');
  const runBtn = h('button', { class: 'primary', onclick: () => runOptimize(bar, status, runBtn, stopBtn) }, '▶ Optimise');
  const stopBtn = h('button', { disabled: true, onclick: () => { if (optRun) optRun.stop = true; } }, '■ Stop');
  $('#tab-optimize').replaceChildren(
    h('div', { class: 'card' },
      h('h3', {}, 'Optimiser'),
      h('div', { class: 'grid' },
        num('From', o, 'lo', 'Hz', { onInput: drawChart }),
        num('To', o, 'hi', 'Hz', { onInput: drawChart }),
        num('Target level', o, 'level', 'dB', { nullable: true, placeholder: 'auto', onInput: drawChart }),
        num('Min impedance', o, 'zmin', 'Ω'),
        num('Iterations', o, 'iters', '')),
      h('label', { class: 'chk', style: 'margin:8px 0' }, h('input', { type: 'checkbox', checked: o.round, onchange: e => { o.round = e.target.checked; saveSoon(); } }), 'Round to standard values when finished (E12 L/C, E24 R)'),
      h('div', { class: 'progress' }, bar),
      h('div', { class: 'row' }, runBtn, stopBtn,
        h('button', { onclick: () => { pushUndo(); M.roundNetwork(project); renderCrossover(); recalc(); toast('Values rounded'); } }, 'Round values now'),
        h('button', { onclick: undo }, '↶ Undo')),
      status),
    h('div', { class: 'card' },
      h('h3', {}, 'Tips'),
      h('ol', { class: 'steps' },
        h('li', {}, 'Start from a quick design on the Crossover tab so the optimiser begins close to a good answer.'),
        h('li', {}, 'Lock (🔒) parts you don’t want changed, e.g. a Zobel or a value you already own.'),
        h('li', {}, 'Leave target level empty to use the current average level. Lower it if the tweeter is too loud and needs padding.'),
        h('li', {}, 'Check polarity and offsets first — the optimiser cannot flip polarity or move drivers.'))));
}

function runOptimize(bar, status, runBtn, stopBtn) {
  if (optRun) return;
  compute();
  const o = project.opt;
  if (!(o.hi > o.lo)) return toast('Range “To” must be above “From”', true);
  if (!M.paramRefs(project).length) return toast('Nothing to optimise — add parts or unlock some', true);
  pushUndo();
  const og = M.logGrid(Math.max(20, o.lo / 1.2), Math.min(20000, o.hi * 1.2), 100);
  const prep = project.drivers.map(d => M.prepareDriver(d, og));
  const level = targetLevel();
  const opt = { lo: o.lo, hi: o.hi, level, zmin: +o.zmin || 0, iters: Math.max(10, +o.iters || 1500) };
  const start = M.costFn(project, prep, og, opt);
  const gen = M.optimizer(project, prep, og, opt);
  optRun = { stop: false };
  runBtn.disabled = true; stopBtn.disabled = false;
  let last = { iter: 0, cost: start };
  const finish = () => {
    for (const d of project.drivers) for (const el of d.network) for (const k of M.KINDS[el.kind].keys) if (el[k] > 0) el[k] = +el[k].toPrecision(3);
    if (o.round) M.roundNetwork(project);
    compute();
    const end = M.costFn(project, prep, og, opt);
    optRun = null; runBtn.disabled = false; stopBtn.disabled = true;
    bar.style.width = '100%';
    status.textContent = `Done: RMS error ${start.toFixed(2)} → ${end.toFixed(2)} dB around ${level.toFixed(1)} dB${o.round ? ' (after rounding)' : ''}.`;
    renderCrossover(); recalc();
  };
  const step = () => {
    const t0 = performance.now();
    while (performance.now() - t0 < 40) {
      const r = gen.next();
      if (r.done) return finish();
      last = r.value;
    }
    bar.style.width = (100 * last.iter / opt.iters).toFixed(0) + '%';
    status.textContent = `Iteration ${last.iter} — RMS error ${last.cost.toFixed(2)} dB`;
    recalc();
    if (optRun.stop) { gen.return(); return finish(); }
    setTimeout(step, 0);
  };
  step();
}

// ------------------------------------------------------------------ export tab

const safeName = s => (s || 'file').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'file';

function bomText() {
  const lines = [`${project.name} — parts list`, ''];
  for (const d of project.drivers) {
    if (!d.enabled) continue;
    lines.push(`${d.name} (${ROLE_LABEL[d.role]})${d.invert ? ' — polarity inverted' : ''}`);
    if (!d.network.length) lines.push('  (direct)');
    d.network.forEach((el, j) => { if (!el.off) lines.push(`  ${j + 1}. ${el.pos === 'series' ? 'Series' : 'Shunt '}  ${fmtEl(el)}${el.kind === 'L' && el.rL ? `  (DCR ${fmt(el.rL)} Ω)` : ''}`); });
    lines.push('');
  }
  return lines.join('\n');
}

function renderExport() {
  const btn = (label, fn) => h('button', { onclick: fn }, label);
  const drvButtons = project.drivers.map((d, i) => h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('span', { class: 'dot', style: `background:${COLORS[i % 4]}` }), h('span', { class: 'name' }, d.name)),
    h('div', { class: 'btn-list' },
      btn('Response with crossover (.frd)', () => { compute(); S.download(safeName(d.name) + '_xo.frd', toFRD(`${d.name} with crossover`, GRID, result.drivers[i].H)); }),
      btn('Driver response (.frd)', () => { compute(); S.download(safeName(d.name) + '.frd', toFRD(`${d.name} (${prepared[i].srcH === 'frd' ? 'from file' : 'T/S simulation'})`, GRID, prepared[i].H)); }),
      btn('Driver impedance (.zma)', () => { compute(); S.download(safeName(d.name) + '.zma', toZMA(`${d.name} (${prepared[i].srcZ === 'zma' ? 'from file' : 'T/S simulation'})`, GRID, prepared[i].Z)); }),
      btn('Input impedance with crossover (.zma)', () => { compute(); S.download(safeName(d.name) + '_xo.zma', toZMA(`${d.name} input impedance with crossover`, GRID, result.drivers[i].Zin)); }))));
  const pre = h('pre', { class: 'schematic', style: 'white-space:pre-wrap' }, bomText());
  $('#tab-export').replaceChildren(
    h('div', { class: 'card' }, h('h3', {}, 'System'),
      h('div', { class: 'btn-list' },
        btn('Summed response (.frd)', () => { compute(); S.download(safeName(project.name) + '_sum.frd', toFRD(`${project.name} summed response`, GRID, result.sum)); }),
        btn('System impedance (.zma)', () => { compute(); S.download(safeName(project.name) + '_sum.zma', toZMA(`${project.name} impedance`, GRID, result.Z)); }),
        btn('Chart image (.png)', () => { const a = h('a', { href: chart.png(), download: safeName(project.name) + '_' + chartType + '.png' }); document.body.append(a); a.click(); a.remove(); }),
        btn('Project file (.json)', saveProject))),
    ...drvButtons,
    h('div', { class: 'card' }, h('h3', {}, 'Parts list'), pre,
      h('div', { class: 'row' },
        btn('Copy', async () => { try { await navigator.clipboard.writeText(bomText()); toast('Copied'); } catch { toast('Copy failed', true); } }),
        btn('Download (.txt)', () => S.download(safeName(project.name) + '_parts.txt', bomText())))));
}

// ------------------------------------------------------------------ help tab

function renderHelp() {
  $('#tab-help').replaceChildren(
    h('div', { class: 'card' }, h('h3', {}, 'Quick start'),
      h('ol', { class: 'steps' },
        h('li', {}, h('b', {}, 'Drivers: '), 'pick a model from the library or type T/S parameters. Set the box and baffle width.'),
        h('li', {}, h('b', {}, 'Better data: '), 'download the manufacturer’s FRD/ZMA files (links below or on each driver) and upload them — ZIP files work too.'),
        h('li', {}, h('b', {}, 'Crossover: '), 'choose a filter type and frequency, press “Design network”, then nudge values with − / +.'),
        h('li', {}, h('b', {}, 'Optimise: '), 'let the optimiser flatten the sum, then round to standard part values.'),
        h('li', {}, h('b', {}, 'Export: '), 'download the parts list, FRD/ZMA results or a share link.'))),
    h('div', { class: 'card' }, h('h3', {}, 'Where to get FRD / ZMA files'),
      SOURCES.map(g => [h('h4', {}, g.group), h('ul', { class: 'src-list' }, g.items.map(s => h('li', {},
        h('a', { class: 'n', href: s.url, target: '_blank', rel: 'noopener' }, s.name), h('div', { class: 'note', style: 'margin:2px 0 0' }, s.note))))]),
      h('p', { class: 'note' }, 'Websites usually block downloads from other sites, so the URL button only works for direct links that allow it (for example raw GitHub files). Otherwise download the file and upload it here.')),
    h('div', { class: 'card' }, h('h3', {}, 'About the simulation'),
      h('ul', { class: 'steps' },
        h('li', {}, 'T/S mode models the driver as a piston in an infinite baffle, sealed or vented box, plus a simple baffle step. It ignores cone break-up and beaming, so treat high-frequency results as rough.'),
        h('li', {}, 'Measured FRD files are used as-is. If they include time-of-flight, either use the phase from file and set offsets, or choose “Minimum phase” and set offsets manually.'),
        h('li', {}, 'Sensitivity is dB SPL at 2.83 V / 1 m. The crossover is driven by an ideal amplifier.'),
        h('li', {}, 'Everything runs in your browser. Projects are saved in this browser automatically; use Save or Share to keep a copy.'))));
}

// ------------------------------------------------------------------ project actions

function renderAll() {
  $('#projectName').value = project.name;
  renderDrivers(); renderCrossover(); renderOptimize(); renderExport(); renderHelp();
}

function setProject(p) {
  project = normalize(p);
  cache.clear();
  undoStack.length = 0;
  renderAll();
  recalc();
}

function saveProject() { S.download(safeName(project.name) + '.xover.json', JSON.stringify(project, null, 1), 'application/json'); }

async function openProject() {
  const f = await S.pickFile('.json,application/json');
  if (!f) return;
  try { setProject(JSON.parse(await f.text())); toast('Project opened'); }
  catch (e) { toast('Could not open: ' + e.message, true); }
}

async function shareProject() {
  try {
    const code = await S.encodeShare(project);
    const url = location.href.split('#')[0] + '#p=' + code;
    if (url.length > 60000) toast('Project is large — the link may be too long for some apps', true);
    if (navigator.share) { try { await navigator.share({ title: project.name, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    await navigator.clipboard.writeText(url);
    toast('Share link copied');
  } catch (e) { toast('Could not create link: ' + e.message, true); }
}

// ------------------------------------------------------------------ wiring

$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  activeTab = b.dataset.tab;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + activeTab));
  if (activeTab === 'export') renderExport();
  if (activeTab === 'crossover') renderCrossover();
  drawChart();
  window.scrollTo({ top: 0 });
});
document.querySelector('.chart-tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-chart]');
  if (!b) return;
  chartType = b.dataset.chart;
  document.querySelectorAll('.chart-tabs button[data-chart]').forEach(x => x.classList.toggle('on', x === b));
  drawChart();
});
$('#showRaw').addEventListener('change', drawChart);
$('#btnCollapse').addEventListener('click', () => { $('#chartWrap').classList.toggle('collapsed'); });
$('#projectName').addEventListener('input', e => { project.name = e.target.value; saveSoon(); });
$('#btnNew').addEventListener('click', () => { if (confirm('Start a new project? The current one will be replaced (save it first if needed).')) setProject(defaultProject()); });
$('#btnOpen').addEventListener('click', openProject);
$('#btnSave').addEventListener('click', saveProject);
$('#btnShare').addEventListener('click', shareProject);

async function init() {
  let p = null;
  const m = location.hash.match(/^#p=(.+)$/);
  if (m) {
    try { p = await S.decodeShare(m[1]); toast('Shared project loaded'); }
    catch { toast('Could not read the shared link', true); }
    history.replaceState(null, '', location.pathname + location.search);
  }
  if (!p) p = S.loadLocal();
  try { setProject(p || defaultProject()); }
  catch { setProject(defaultProject()); }
}
init();
