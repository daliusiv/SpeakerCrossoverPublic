// Minimal log-frequency canvas chart with touch/mouse cursor readout.

const fmtHz = f => (f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2) + ' kHz' : f.toFixed(f < 100 ? 1 : 0) + ' Hz');
const xLabel = f => (f >= 1000 ? f / 1000 + 'k' : String(f));

function niceStep(range, target) {
  const raw = range / target, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}

export class Chart {
  constructor(canvas, readout) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.readout = readout;
    this.cfg = null;
    this.cursor = null;
    new ResizeObserver(() => this.draw()).observe(canvas);
    const move = e => {
      if (e.pointerType !== 'mouse' && !e.buttons && e.type !== 'pointerdown') return;
      const r = canvas.getBoundingClientRect();
      const f = this.xToF(e.clientX - r.left);
      if (f) { this.cursor = f; this.draw(); }
    };
    canvas.addEventListener('pointerdown', move);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { this.cursor = null; this.draw(); } });
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => this.draw());
  }

  set(cfg) { this.cfg = cfg; this.draw(); }

  get pad() { return { l: 40, r: this.cfg && this.cfg.y2 ? 40 : 12, t: 10, b: 22 }; }

  xToF(px) {
    if (!this.cfg) return null;
    const { l, r } = this.pad, w = this.c.clientWidth - l - r;
    const t = (px - l) / w;
    if (t < 0 || t > 1) return null;
    return Math.exp(Math.log(this.cfg.xmin) + t * Math.log(this.cfg.xmax / this.cfg.xmin));
  }

  draw() {
    const cfg = this.cfg, c = this.c, ctx = this.ctx;
    if (!cfg || !c.clientWidth) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const col = n => css.getPropertyValue(n).trim();
    const fg = col('--text'), muted = col('--muted'), grid = col('--grid'), bg = col('--chart-bg');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const { l, r, t, b } = this.pad;
    const pw = W - l - r, ph = H - t - b;
    const lx0 = Math.log(cfg.xmin), lxr = Math.log(cfg.xmax / cfg.xmin);
    const X = f => l + (Math.log(f) - lx0) / lxr * pw;
    const mkY = ax => v => t + (1 - (v - ax.min) / (ax.max - ax.min)) * ph;
    const Y1 = mkY(cfg.y), Y2 = cfg.y2 ? mkY(cfg.y2) : null;
    ctx.font = '11px system-ui, sans-serif';

    // bands
    for (const bd of cfg.bands || []) {
      ctx.fillStyle = bd.color;
      const x0 = X(Math.max(bd.x0, cfg.xmin)), x1 = X(Math.min(bd.x1, cfg.xmax));
      const y0 = Y1(bd.y1), y1 = Y1(bd.y0);
      ctx.fillRect(x0, Math.max(t, y0), x1 - x0, Math.min(t + ph, y1) - Math.max(t, y0));
    }

    // grid
    ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.fillStyle = muted;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let d = 1; d <= 100000; d *= 10) for (let m = 1; m < 10; m++) {
      const f = d * m;
      if (f < cfg.xmin || f > cfg.xmax) continue;
      const x = Math.round(X(f)) + 0.5;
      ctx.globalAlpha = m === 1 ? 0.9 : 0.4;
      ctx.beginPath(); ctx.moveTo(x, t); ctx.lineTo(x, t + ph); ctx.stroke();
      ctx.globalAlpha = 1;
      if (m === 1 || m === 2 || m === 5) ctx.fillText(xLabel(f), x, t + ph + 5);
    }
    const yAxis = (ax, Yf, side) => {
      const step = ax.step || niceStep(ax.max - ax.min, Math.max(3, Math.floor(ph / 32)));
      ctx.textAlign = side === 'l' ? 'right' : 'left'; ctx.textBaseline = 'middle';
      for (let v = Math.ceil(ax.min / step) * step; v <= ax.max + 1e-9; v += step) {
        const y = Math.round(Yf(v)) + 0.5;
        if (side === 'l') { ctx.beginPath(); ctx.moveTo(l, y); ctx.lineTo(l + pw, y); ctx.stroke(); }
        ctx.fillText(+v.toFixed(2) + '', side === 'l' ? l - 5 : l + pw + 5, y);
      }
    };
    yAxis(cfg.y, Y1, 'l');
    if (cfg.y2) yAxis(cfg.y2, Y2, 'r');
    ctx.save();
    ctx.fillStyle = muted; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(cfg.y.label || '', l + 4, t + 2);
    if (cfg.y2) { ctx.textAlign = 'right'; ctx.fillText(cfg.y2.label || '', l + pw - 4, t + 2); }
    ctx.restore();

    // lines
    for (const ln of cfg.hlines || []) {
      ctx.strokeStyle = ln.color; ctx.setLineDash(ln.dash || [4, 4]);
      const y = Y1(ln.y);
      ctx.beginPath(); ctx.moveTo(X(ln.x0 || cfg.xmin), y); ctx.lineTo(X(ln.x1 || cfg.xmax), y); ctx.stroke();
      ctx.setLineDash([]);
    }

    // series
    ctx.save();
    ctx.beginPath(); ctx.rect(l, t, pw, ph); ctx.clip();
    for (const s of cfg.series) {
      const Yf = s.axis === 'y2' ? Y2 : Y1;
      ctx.strokeStyle = s.color === 'fg' ? fg : s.color;
      ctx.lineWidth = s.width || 1.5;
      ctx.globalAlpha = s.alpha ?? 1;
      ctx.setLineDash(s.dash || []);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let prev = null;
      for (let i = 0; i < s.x.length; i++) {
        const v = s.y[i];
        if (!isFinite(v)) { prev = null; continue; }
        const x = X(s.x[i]), y = Yf(v);
        if (prev === null || (s.wrap && Math.abs(v - prev) > 180)) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        prev = v;
      }
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1; ctx.setLineDash([]);

    // cursor
    let html = '';
    if (this.cursor && this.cursor >= cfg.xmin && this.cursor <= cfg.xmax) {
      const x = Math.round(X(this.cursor)) + 0.5;
      ctx.strokeStyle = fg; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(x, t); ctx.lineTo(x, t + ph); ctx.stroke();
      ctx.globalAlpha = 1;
      html = `<b>${fmtHz(this.cursor)}</b>`;
      for (const s of cfg.series) {
        if (s.noReadout) continue;
        const v = sample(s.x, s.y, this.cursor);
        if (!isFinite(v)) continue;
        const Yf = s.axis === 'y2' ? Y2 : Y1;
        ctx.fillStyle = s.color === 'fg' ? fg : s.color;
        ctx.beginPath(); ctx.arc(x, Yf(v), 3, 0, 7); ctx.fill();
        const color = s.color === 'fg' ? 'var(--text)' : s.color;
        html += ` <span class="ro"><i style="background:${color}"></i>${s.name} ${v.toFixed(s.digits ?? 1)}${s.unit || ''}</span>`;
      }
    } else html = '<span class="muted">Tap or drag on the chart to read values</span>';
    if (this.readout) this.readout.innerHTML = html;
  }

  png() { return this.c.toDataURL('image/png'); }
}

function sample(xs, ys, f) {
  let k = 0;
  while (k < xs.length - 1 && xs[k + 1] < f) k++;
  if (k >= xs.length - 1) return ys[xs.length - 1];
  const t = Math.log(f / xs[k]) / Math.log(xs[k + 1] / xs[k]);
  return ys[k] + Math.max(0, Math.min(1, t)) * (ys[k + 1] - ys[k]);
}
