// JourneyMan — small hand-made SVG charts. Thin marks, 2px surface gaps, recessive grid,
// a legend for two or more series, and a tooltip on every mark (also on keyboard focus).
// Labels go in with textContent, never innerHTML.

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}, parent) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};
const text = (parent, attrs, content) => { const t = el('text', attrs, parent); t.textContent = content; return t; };

/* Clean axis ticks: 0 and 3–5 round steps up to at least `max`. */
export function niceTicks(max, count = 4) {
  if (!(max > 0)) max = 1;
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}

/* A column with a 4px rounded data end and a square baseline. */
function columnPath(x, y, w, h, round) {
  if (h <= 0) return '';
  const r = round ? Math.min(4, h, w / 2) : 0;
  return `M${x},${y + h}V${y + r}${r ? `Q${x},${y} ${x + r},${y}` : ''}H${x + w - r}${r ? `Q${x + w},${y} ${x + w},${y + r}` : ''}V${y + h}Z`;
}

/* ---------- one shared tooltip ---------- */
let tip;
function tooltip() {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.setAttribute('role', 'status');
    tip.hidden = true;
    document.body.appendChild(tip);
  }
  return tip;
}
/* rows: [{ value, label, color? }] — values lead, labels follow, a short line key per series. */
function showTip(target, title, rows) {
  const t = tooltip();
  t.replaceChildren();
  const h = document.createElement('div');
  h.className = 'tip-title';
  h.textContent = title;
  t.appendChild(h);
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'tip-row';
    if (r.color) { const k = document.createElement('i'); k.style.background = r.color; row.appendChild(k); }
    const v = document.createElement('b'); v.textContent = r.value; row.appendChild(v);
    const l = document.createElement('span'); l.textContent = r.label; row.appendChild(l);
    t.appendChild(row);
  }
  t.hidden = false;
  const box = target.getBoundingClientRect();
  const tw = t.offsetWidth, th = t.offsetHeight;
  let left = box.left + box.width / 2 - tw / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
  let top = box.top - th - 8;
  if (top < 8) top = box.bottom + 8;
  t.style.left = `${left + window.scrollX}px`;
  t.style.top = `${top + window.scrollY}px`;
}
export function hideTip() { if (tip) tip.hidden = true; }

function hover(node, fn) {
  node.setAttribute('tabindex', '0');
  node.addEventListener('pointerenter', () => { node.classList.add('hot'); fn(); });
  node.addEventListener('pointerleave', () => { node.classList.remove('hot'); hideTip(); });
  node.addEventListener('focus', () => { node.classList.add('hot'); fn(); });
  node.addEventListener('blur', () => { node.classList.remove('hot'); hideTip(); });
}

function legend(series) {
  const div = document.createElement('div');
  div.className = 'chart-legend';
  for (const s of series) {
    const item = document.createElement('span');
    const sw = document.createElement('i');
    sw.style.background = s.color;
    if (s.dashed) sw.className = 'ref';
    item.appendChild(sw);
    item.appendChild(document.createTextNode(s.label));
    div.appendChild(item);
  }
  return div;
}

/*
  Stacked columns.
  categories: [{ key, label, sub? }]
  series:     [{ key, label, color }]  (fixed order; colour follows the entity)
  value(categoryKey, seriesKey) → number
  format(n) → string for ticks and tooltips
  reference?: { value(categoryKey), label } — a short level marker per column (e.g. hours available)
  note?(categoryKey) → string | null — a label above the column (e.g. "6h over")
*/
export function stackedColumns(container, { categories, series, value, format, height = 220, reference, note, title }) {
  container.replaceChildren();
  container.classList.add('chart');
  const width = Math.max(container.clientWidth || 640, 280);
  const pad = { top: reference || note ? 26 : 12, right: 8, bottom: 34, left: 44 };
  const totals = categories.map((c) => series.reduce((s, x) => s + (value(c.key, x.key) || 0), 0));
  const refMax = reference ? Math.max(...categories.map((c) => reference.value(c.key) || 0)) : 0;
  const ticks = niceTicks(Math.max(...totals, refMax, 0.0001));
  const yMax = ticks[ticks.length - 1];
  const plotH = height - pad.top - pad.bottom;
  const plotW = width - pad.left - pad.right;
  const band = plotW / categories.length;
  const barW = Math.min(24, band * 0.56);
  const Y = (v) => pad.top + plotH - (v / yMax) * plotH;

  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': title || 'Chart' });
  const grid = el('g', { class: 'grid' }, svg);
  for (const t of ticks) {
    el('line', { x1: pad.left, x2: width - pad.right, y1: Y(t), y2: Y(t) }, grid);
    text(grid, { x: pad.left - 8, y: Y(t) + 4, 'text-anchor': 'end', class: 'tick' }, format(t, true));
  }
  categories.forEach((c, i) => {
    const cx = pad.left + band * i + band / 2;
    const g = el('g', { class: 'col' }, svg);
    el('rect', { x: cx - band / 2, y: pad.top - 10, width: band, height: plotH + 10, class: 'hit' }, g);
    let base = 0;
    const parts = series.map((s) => ({ s, v: value(c.key, s.key) || 0 })).filter((p) => p.v > 0);
    parts.forEach((p, j) => {
      const y0 = Y(base), y1 = Y(base + p.v);
      const top = j === parts.length - 1;
      const h = Math.max(y0 - y1 - (j > 0 ? 2 : 0), 0); // 2px surface gap between segments
      const d = columnPath(cx - barW / 2, y1, barW, h, top);
      if (d) el('path', { d, fill: p.s.color, class: 'seg' }, g);
      base += p.v;
    });
    if (reference) {
      const rv = reference.value(c.key);
      if (rv > 0) el('line', { x1: cx - barW / 2 - 6, x2: cx + barW / 2 + 6, y1: Y(rv), y2: Y(rv), class: 'ref' }, g);
    }
    const n = note && note(c.key);
    if (n) text(g, { x: cx, y: Math.min(Y(totals[i]), reference ? Y(reference.value(c.key) || 0) : Infinity) - 8, 'text-anchor': 'middle', class: 'note' }, n);
    text(g, { x: cx, y: height - pad.bottom + 16, 'text-anchor': 'middle', class: 'xlab' }, c.label);
    if (c.sub) text(g, { x: cx, y: height - pad.bottom + 29, 'text-anchor': 'middle', class: 'xsub' }, c.sub);
    g.setAttribute('aria-label', `${c.label}: ${format(totals[i])}`);
    hover(g, () => {
      const rows = series.map((s) => ({ s, v: value(c.key, s.key) || 0 })).filter((p) => p.v > 0)
        .map((p) => ({ value: format(p.v), label: p.s.label, color: p.s.color }));
      if (rows.length > 1) rows.unshift({ value: format(totals[i]), label: 'Total' });
      if (!rows.length) rows.push({ value: format(0), label: series.length === 1 ? series[0].label : 'Total' });
      if (reference) rows.push({ value: format(reference.value(c.key) || 0), label: reference.label });
      showTip(g, c.label + (c.sub ? ' ' + c.sub : ''), rows);
    });
  });
  el('line', { x1: pad.left, x2: width - pad.right, y1: Y(0), y2: Y(0), class: 'baseline' }, svg);
  container.appendChild(svg);
  const keys = series.length > 1 ? [...series] : [];
  if (reference) keys.push({ label: reference.label, color: 'var(--ink-2)', dashed: true });
  if (keys.length) container.appendChild(legend(keys));
}

/*
  Heatmap of rows × columns, one sequential hue light → dark.
  rows: [{ key, label }], cols: [{ key, label }] (label shown every `labelEvery` columns)
*/
export function heatmap(container, { rows, cols, value, format, labelEvery = 3, title }) {
  container.replaceChildren();
  container.classList.add('chart');
  const width = Math.max(container.clientWidth || 640, 280);
  const pad = { top: 6, right: 4, bottom: 22, left: 36 };
  const cw = (width - pad.left - pad.right) / cols.length;
  const ch = Math.min(22, Math.max(14, cw));
  const height = pad.top + rows.length * ch + pad.bottom;
  const max = Math.max(...rows.flatMap((r) => cols.map((c) => value(r.key, c.key) || 0)), 0);
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': title || 'Heatmap' });
  rows.forEach((r, i) => {
    text(svg, { x: pad.left - 6, y: pad.top + i * ch + ch / 2 + 4, 'text-anchor': 'end', class: 'tick' }, r.label);
    cols.forEach((c, j) => {
      const v = value(r.key, c.key) || 0;
      const step = v > 0 ? Math.min(6, 1 + Math.floor((v / max) * 6)) : 0; // 0 = empty, 1–6 = ramp steps
      const cell = el('rect', {
        x: pad.left + j * cw + 1, y: pad.top + i * ch + 1, width: Math.max(cw - 2, 1), height: ch - 2, rx: 3,
        class: `cell s${step}`, 'aria-label': `${r.label} ${c.label}: ${format(v)}`,
      }, svg);
      hover(cell, () => showTip(cell, `${r.label} ${c.label}`, [{ value: format(v), label: 'tracked' }]));
    });
  });
  cols.forEach((c, j) => {
    if (j % labelEvery === 0) text(svg, { x: pad.left + j * cw + cw / 2, y: height - 6, 'text-anchor': 'middle', class: 'xsub' }, c.label);
  });
  container.appendChild(svg);
  const scale = document.createElement('div');
  scale.className = 'heat-scale';
  scale.innerHTML = '<span>Less</span>' + [1, 2, 3, 4, 5, 6].map((s) => `<i class="s${s}"></i>`).join('') + '<span>More</span>';
  container.appendChild(scale);
}

/*
  A 2×2: points placed on two 0–1 scores, one colour, quadrant names in the corners.
  points: [{ x, y, label, sub, onClick }]
*/
export function matrix(container, { points, xLabel, yLabel, quadrants, title }) {
  container.replaceChildren();
  container.classList.add('chart');
  const width = Math.max(container.clientWidth || 640, 280);
  const height = Math.min(360, Math.max(240, width * 0.55));
  const pad = { top: 10, right: 10, bottom: 26, left: 26 };
  const W = width - pad.left - pad.right, H = height - pad.top - pad.bottom;
  const X = (v) => pad.left + v * W, Y = (v) => pad.top + (1 - v) * H;
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': title || 'Matrix' });
  el('rect', { x: X(0.5), y: Y(1), width: W / 2, height: H / 2, class: 'quad-hot' }, svg);
  const g = el('g', { class: 'grid' }, svg);
  el('line', { x1: X(0.5), x2: X(0.5), y1: Y(0), y2: Y(1) }, g);
  el('line', { x1: X(0), x2: X(1), y1: Y(0.5), y2: Y(0.5) }, g);
  el('rect', { x: X(0), y: Y(1), width: W, height: H, class: 'frame' }, g);
  const [tl, tr, bl, br] = quadrants;
  text(svg, { x: X(0) + 8, y: Y(1) + 16, class: 'quad' }, tl);
  text(svg, { x: X(1) - 8, y: Y(1) + 16, 'text-anchor': 'end', class: 'quad' }, tr);
  text(svg, { x: X(0) + 8, y: Y(0.5) + 16, class: 'quad' }, bl);
  text(svg, { x: X(1) - 8, y: Y(0.5) + 16, 'text-anchor': 'end', class: 'quad' }, br);
  text(svg, { x: X(0.5), y: height - 6, 'text-anchor': 'middle', class: 'xsub' }, xLabel + ' →');
  text(svg, { x: 12, y: Y(0.5), 'text-anchor': 'middle', class: 'xsub', transform: `rotate(-90 12 ${Y(0.5)})` }, yLabel + ' →');
  // Points within a dot's width of each other are spread round a small ring so each stays visible and hoverable.
  const placed = [];
  for (const p of points) {
    let cx = X(Math.min(Math.max(p.x, 0.02), 0.98));
    let cy = Y(Math.min(Math.max(p.y, 0.03), 0.97));
    const near = placed.filter(([x, y]) => Math.hypot(x - cx, y - cy) < 12).length;
    if (near) {
      const angle = near * 2.4; // golden-angle spiral
      const radius = 12 + 4 * Math.floor(near / 6);
      cx += Math.cos(angle) * radius;
      cy += Math.sin(angle) * radius;
    }
    placed.push([cx, cy]);
    const dot = el('g', { class: 'pt', 'aria-label': p.label }, svg);
    el('circle', { cx, cy, r: 12, class: 'hit' }, dot);
    el('circle', { cx, cy, r: 5, class: 'dot' }, dot);
    hover(dot, () => showTip(dot, p.label, p.sub ? [{ value: '', label: p.sub }] : []));
    if (p.onClick) {
      dot.addEventListener('click', p.onClick);
      dot.addEventListener('keydown', (e) => { if (e.key === 'Enter') p.onClick(); });
    }
  }
  container.appendChild(svg);
}
