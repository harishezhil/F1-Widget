const BASE = 'https://api.openf1.org/v1/';
const api = (p) => window.f1.get(BASE + p);
const iso = (ms) => new Date(ms).toISOString().slice(0, -1);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// delay = how far behind "now" we draw; chunk = size of each download; lead = how far ahead we pre-download
const LIVE_CFG   = { delay: 10000, locChunk: 6000,  tmChunk: 15000, locLead: 0,     tmLead: 0 };
const REPLAY_CFG = { delay: 3000,  locChunk: 20000, tmChunk: 60000, locLead: 30000, tmLead: 90000 };
let CFG = REPLAY_CFG;

const TYRE = { SOFT: '#ff3b3b', MEDIUM: '#ffd93b', HARD: '#f2f2f2', INTERMEDIATE: '#3fcf5f', WET: '#3b8cff' };

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const wrap = document.querySelector('.mapwrap');
const stageEl = document.querySelector('.stage');
const towerEl = document.getElementById('tower');
const titleEl = document.getElementById('title');
const badgeEl = document.getElementById('badge');
const lapEl = document.getElementById('lap');
const track = document.createElement('canvas');   // cached track drawing
const tctx = track.getContext('2d');

let W = 0, H = 0, dpr = 1, stageH = 200, rowH = 16;
let session, sessionStart = 0, isRace = false, live = false, replayBase = 0, wallStart = Date.now();
let outline = [], bounds = null;
const drivers = {};   // number -> { acr, color }
const cars = {};      // number -> { samples, last, ang }
const posEv = {};     // number -> [{t, p}]
const intEv = {};     // number -> [{t, v}]
let lapsBy = {}, stintsBy = {}, totalLaps = 0, lastTower = '';

const clock = () => live ? Date.now() : replayBase + (Date.now() - wallStart);

/* ---------- layout ---------- */
function resize() {
  const r = wrap.getBoundingClientRect();
  if (!r.width || !r.height) return;
  dpr = window.devicePixelRatio || 1;
  W = r.width; H = r.height;
  canvas.width = W * dpr; canvas.height = H * dpr;
  track.width = W * dpr; track.height = H * dpr;
  stageH = stageEl.getBoundingClientRect().height;
  rowH = Math.max(14, Math.min(22, Math.floor(stageH / 20)));
  document.documentElement.style.setProperty('--rh', rowH + 'px');
  drawTrack();
}
new ResizeObserver(resize).observe(wrap);

function computeBounds() {
  const xs = outline.map(p => p.x), ys = outline.map(p => p.y);
  bounds = { minX: Math.min(...xs), maxX: Math.max(...xs),
             minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function toScreen(x, y) {
  const pad = Math.max(10, Math.min(24, Math.min(W, H) / 8));
  const dx = bounds.maxX - bounds.minX || 1, dy = bounds.maxY - bounds.minY || 1;
  const s = Math.min((W - pad * 2) / dx, (H - pad * 2) / dy);
  const ox = (W - dx * s) / 2, oy = (H - dy * s) / 2;
  return [ox + (x - bounds.minX) * s, H - (oy + (y - bounds.minY) * s)];   // flip Y
}

/* ---------- track (drawn once per resize) ---------- */
function drawTrack() {
  tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  tctx.clearRect(0, 0, W, H);
  if (!bounds) return;

  const path = new Path2D();
  outline.forEach((p, i) => {
    const [x, y] = toScreen(p.x, p.y);
    i ? path.lineTo(x, y) : path.moveTo(x, y);
  });
  path.closePath();

  const lw = Math.max(3, Math.min(13, Math.min(W, H) / 26));
  tctx.lineJoin = tctx.lineCap = 'round';

  tctx.strokeStyle = 'rgba(225,6,0,.35)';  tctx.lineWidth = lw + 7; tctx.stroke(path);   // soft red halo
  tctx.strokeStyle = '#f4f4f7';            tctx.lineWidth = lw + 3; tctx.stroke(path);   // white broadcast edge
  tctx.strokeStyle = '#17171d';            tctx.lineWidth = lw;     tctx.stroke(path);   // dark tarmac

  if (lw > 6) {                                      // thin red racing line
    tctx.setLineDash([6, 8]);
    tctx.strokeStyle = 'rgba(225,6,0,.75)'; tctx.lineWidth = 1.2;
    tctx.stroke(path);
    tctx.setLineDash([]);
  }
}
/* ---------- data: one downloader for each kind of data ---------- */
const state = { loc: { to: 0, busy: false }, pos: { to: 0, busy: false }, int: { to: 0, busy: false } };

async function pump(key, endpoint, chunk, lead, startFn, add) {
  const s = state[key];
  if (s.busy || !session) return;
  s.busy = true;
  try {
    for (;;) {
      const now = clock();
      let a = s.to, b;
      if (!a) { a = startFn(now); b = now + lead; }          // first download
      else if (a + chunk <= now + lead) b = a + chunk;       // next chunk is due
      else break;                                            // nothing to do yet
      const rows = await api(`${endpoint}?session_key=${session.session_key}` +
        `&date>=${iso(a)}&date<${iso(b)}`);
      if (!Array.isArray(rows)) break;                       // failed: try again on the next tick
      add(rows);
      s.to = b;
    }
  } finally {
    s.busy = false;
  }
}

function pumpAll() {
  return Promise.all([
    pump('loc', 'location', CFG.locChunk, CFG.locLead, now => now - CFG.delay - 2000, addLoc),
    pump('pos', 'position', CFG.tmChunk, CFG.tmLead, () => sessionStart - 3600000, addPos),
    pump('int', 'intervals', CFG.tmChunk, CFG.tmLead, now => now - 60000, addInt),
  ]);
}

function addLoc(rows) {
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  rows.forEach(r => {
    const t = Date.parse(r.date);
    const c = cars[r.driver_number] || (cars[r.driver_number] = { samples: [], last: 0, ang: 0 });
    if (t <= c.last) return;
    c.last = t;
    c.samples.push({ t, x: r.x, y: r.y });
  });
}

function addPos(rows) {
  rows.forEach(r => (posEv[r.driver_number] ||= []).push({ t: Date.parse(r.date), p: r.position }));
}

function addInt(rows) {
  rows.forEach(r => {
    const a = (intEv[r.driver_number] ||= []);
    a.push({ t: Date.parse(r.date), v: r.interval });
    if (a.length > 300) a.shift();
  });
}

async function loadLaps() {
  const rows = await api(`laps?session_key=${session.session_key}`);
  if (!Array.isArray(rows) || !rows.length) return;
  const by = {}; let mx = 0;
  rows.forEach(r => {
    (by[r.driver_number] ||= []).push({ n: r.lap_number, t: r.date_start ? Date.parse(r.date_start) : null });
    if (r.lap_number > mx) mx = r.lap_number;
  });
  Object.values(by).forEach(a => a.sort((x, y) => x.n - y.n));
  lapsBy = by;
  if (!live) totalLaps = mx;
}

async function loadStints() {
  const rows = await api(`stints?session_key=${session.session_key}`);
  if (!Array.isArray(rows)) return;
  const by = {};
  rows.forEach(r => (by[r.driver_number] ||= []).push({ a: r.lap_start || 1, b: r.lap_end || 9999, c: r.compound }));
  stintsBy = by;
}

/* ---------- smooth position: curve through the real samples ---------- */
function sampleAt(c, rt) {
  const s = c.samples;
  if (!s.length) return null;
  if (s.length === 1 || rt <= s[0].t) return { x: s[0].x, y: s[0].y, tx: 0, ty: 0 };
  const last = s[s.length - 1];
  if (rt >= last.t) return { x: last.x, y: last.y, tx: 0, ty: 0 };

  while (s.length > 4 && s[2].t <= rt) s.shift();            // forget old samples
  let i = 0;
  while (i < s.length - 2 && s[i + 1].t <= rt) i++;
  const p0 = s[i - 1] || s[i], p1 = s[i], p2 = s[i + 1], p3 = s[i + 2] || s[i + 1];
  const k = (rt - p1.t) / ((p2.t - p1.t) || 1), k2 = k * k, k3 = k2 * k;

  const cr = (a, b, c2, d) =>
    0.5 * ((2 * b) + (-a + c2) * k + (2 * a - 5 * b + 4 * c2 - d) * k2 + (-a + 3 * b - 3 * c2 + d) * k3);
  const tg = (a, b, c2, d) =>
    0.5 * ((-a + c2) + 2 * (2 * a - 5 * b + 4 * c2 - d) * k + 3 * (-a + 3 * b - 3 * c2 + d) * k2);

  return { x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y),
           tx: tg(p0.x, p1.x, p2.x, p3.x), ty: tg(p0.y, p1.y, p2.y, p3.y) };
}

/* ---------- timing tower + lap counter ---------- */
function latestBefore(arr, rt) {
  if (!arr) return null;
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i].t <= rt) return arr[i];
  return null;
}

function lapAt(n, rt) {
  const a = lapsBy[n];
  if (!a) return 0;
  let cur = 0;
  for (const l of a) { if ((l.t ?? sessionStart) <= rt) cur = l.n; else break; }
  return cur;
}

function tyreAt(n, lap) {
  const a = stintsBy[n];
  if (!a) return null;
  for (const s of a) if (lap >= s.a && lap <= s.b) return s.c;
  return null;
}

function fmtGap(v) {
  if (typeof v === 'number') return '+' + v.toFixed(3);
  if (typeof v === 'string' && v) return v;
  return '–';
}

function updateTower() {
  if (!session) return;
  const rt = clock() - CFG.delay;
  const rows = [];
  for (const n in posEv) {
    const e = latestBefore(posEv[n], rt);
    if (e) rows.push({ n, p: e.p });
  }
  if (!rows.length) return;
  rows.sort((a, b) => a.p - b.p);

  if (isRace) {
    const lap = lapAt(rows[0].n, rt) || 1;
    lapEl.hidden = false;
    lapEl.innerHTML = `LAP<b>${lap}${totalLaps ? '/' + totalLaps : ''}</b>`;
  }

  const max = Math.max(1, Math.floor((stageH - 8) / (rowH + 1)));
  const html = rows.slice(0, max).map((r, i) => {
    const d = drivers[r.n] || { acr: r.n, color: '#fff' };
    const lead = i === 0;
    const iv = latestBefore(intEv[r.n], rt);
    const gap = lead ? 'LEADER' : fmtGap(iv && iv.v);
    const tyre = tyreAt(r.n, lapAt(r.n, rt));
    const dot = tyre ? `<span class="t" style="border-color:${TYRE[tyre] || '#777'}"></span>` : '';
    return `<div class="row"><span class="p">${r.p}</span><span class="c" style="background:${esc(d.color)}"></span>` +
           `<span class="n">${esc(d.acr)}</span><span class="g${lead ? ' lead' : ''}">${esc(gap)}</span>${dot}</div>`;
  }).join('');
  if (html !== lastTower) { towerEl.innerHTML = html; lastTower = html; }
}

/* ---------- drawing cars (no blur effects, they were the slow part) ---------- */
function drawCar(px, py, ang, color, s) {
  ctx.save();
  ctx.translate(px, py); ctx.rotate(ang); ctx.scale(s, s);

  ctx.globalAlpha = 0.28;                                    // cheap glow
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(0, 0, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = '#0b0b0e';                                 // wheels
  [[-5, -4.4], [-5, 4.4], [4, -4], [4, 4]].forEach(([x, y]) => ctx.fillRect(x - 2, y - 1.3, 4, 2.6));

  ctx.fillStyle = color;
  ctx.fillRect(-8.5, -4.6, 2, 9.2);                          // rear wing
  ctx.fillRect(7.2, -4.2, 1.8, 8.4);                         // front wing
  ctx.beginPath();                                           // body + nose
  ctx.moveTo(9, 0); ctx.lineTo(4, -1.3); ctx.lineTo(-3, -2.3); ctx.lineTo(-7, -1.6);
  ctx.lineTo(-7, 1.6); ctx.lineTo(-3, 2.3); ctx.lineTo(4, 1.3); ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 0.5; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.stroke();

  ctx.fillStyle = '#f4f4f7';                                 // helmet
  ctx.beginPath(); ctx.arc(-1, 0, 1.3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawLabel(px, py, text, color, cs) {
  const ls = Math.max(0.8, Math.min(1.3, cs));
  ctx.font = `800 italic ${7.5 * ls}px "Arial Narrow", -apple-system, sans-serif`;
  const h = 9 * ls, w = ctx.measureText(text).width + 10 * ls, sk = 2.5 * ls, bar = 2.4 * ls;
  const x = px - w / 2, y = py - 7 * cs - h - 3;

  ctx.beginPath();                                   // dark slanted tag
  ctx.moveTo(x + sk, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - sk, y + h); ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fillStyle = 'rgba(12,12,16,.92)'; ctx.fill();

  ctx.beginPath();                                   // team-colour bar
  ctx.moveTo(x + sk, y); ctx.lineTo(x + sk + bar, y); ctx.lineTo(x + bar, y + h); ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fillStyle = color; ctx.fill();

  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2 + bar / 2, y + h / 2 + 0.3);
}

function frame() {
  const rt = clock() - CFG.delay;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(track, 0, 0, W, H);

  const cs = Math.max(0.4, Math.min(1.8, Math.min(W, H) / 190));   // car size follows the map size
  const labels = [];

  for (const [n, c] of Object.entries(cars)) {
    const p = sampleAt(c, rt);
    if (!p) continue;
    const [px, py] = toScreen(p.x, p.y);

    if (p.tx * p.tx + p.ty * p.ty > 4) {                     // turn toward direction of travel
      const target = Math.atan2(-p.ty, p.tx);                // screen Y is flipped
      const diff = ((target - c.ang + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      c.ang += diff * 0.15;
    }

    const d = drivers[n] || { acr: n, color: '#ffffff' };
    drawCar(px, py, c.ang, d.color, cs);
    labels.push([px, py, d.acr, d.color]);
  }
  if (cs >= 0.6) labels.forEach(l => drawLabel(l[0], l[1], l[2], l[3], cs));

  requestAnimationFrame(frame);
}

/* ---------- startup ---------- */
async function init() {
  const ss = await api('sessions?session_key=latest');
  const s = ss && ss[0];
  if (!s) { titleEl.textContent = 'Connecting…'; return setTimeout(init, 8000); }
  session = s;

  sessionStart = Date.parse(s.date_start);
  const end = Date.parse(s.date_end);
  isRace = s.session_type === 'Race';
  live = Date.now() > sessionStart && Date.now() < end;
  CFG = live ? LIVE_CFG : REPLAY_CFG;
  replayBase = Math.min(sessionStart + 15 * 60 * 1000, end - 5 * 60 * 1000);

  ((await api('drivers?session_key=' + s.session_key)) || []).forEach(d => {
    drivers[d.driver_number] = { acr: d.name_acronym, color: '#' + (d.team_colour || 'ffffff') };
  });
  const first = Object.keys(drivers)[0];
  if (!first) { titleEl.textContent = 'Connecting…'; return setTimeout(init, 8000); }

  const t0 = live ? Date.now() - 130000 : replayBase;
  const pts = (await api(`location?session_key=${s.session_key}&driver_number=${first}` +
    `&date>=${iso(t0)}&date<${iso(t0 + 100000)}`)) || [];
  outline = pts.filter(p => p.x || p.y).map(p => ({ x: p.x, y: p.y }));
  if (outline.length < 20) { titleEl.textContent = 'Waiting for data…'; return setTimeout(init, 10000); }
  computeBounds();

  titleEl.textContent = `${s.circuit_short_name} · ${s.session_name}`;
  badgeEl.className = live ? 'live' : '';
  badgeEl.innerHTML = `<i></i><span>${live ? 'LIVE' : 'REPLAY'}</span>`;
  resize();

  wallStart = Date.now();                                    // replay clock starts now
  await Promise.all([pumpAll(), loadLaps(), loadStints()]);
  updateTower();

  setInterval(pumpAll, 1000);                                // only downloads when a chunk is due
  setInterval(updateTower, 500);
  if (live) { setInterval(loadLaps, 60000); setInterval(loadStints, 120000); }
  requestAnimationFrame(frame);
}

resize();
init();