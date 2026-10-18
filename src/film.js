// 《梅香寄北堂》—— 画面引擎
// 所有画面都是时间 t（秒）的纯函数：FILM.render(t) 画出第 t 秒的一帧，
// 因此既可以在浏览器里实时播放，也可以逐帧离线渲染成视频。
(() => {
'use strict';

const W = 1920, H = 1080;
const C = window.CONTENT;
const canvas = document.getElementById('film');
const ctx = canvas.getContext('2d');

const FONT = { brush: 'MaShanZheng', xing: 'ZhiMangXing', kai: 'WenKai' };
const INK = '#1e1b17';
const CINNABAR = '#b5262c';

// ---------------------------------------------------------------- 工具
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - Math.pow(1 - clamp(t), 3);
const ramp = (t, a, b) => clamp((t - a) / (b - a));
// 在 [a,b] 区间内淡入淡出的窗口
const win = (t, a, b, fi = 1, fo = 1) => Math.min(smooth((t - a) / fi), smooth((b - t) / fo));
function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function noise1(seed) {
  const r = mulberry32(seed);
  const v = Array.from({ length: 1024 }, () => r());
  return x => {
    const i = Math.floor(x), f = x - i;
    const a = v[i & 1023], b = v[(i + 1) & 1023];
    return a + (b - a) * f * f * (3 - 2 * f);
  };
}
function fbm(n, x, oct = 4) {
  let s = 0, a = 0.5, f = 1, tot = 0;
  for (let i = 0; i < oct; i++) { s += a * n(x * f + i * 31.7); tot += a; a *= 0.5; f *= 2; }
  return s / tot;
}

// ---------------------------------------------------------------- 构图常量
const MOON = { x: 250, y: 205, r: 108 };
const CARD = { x: 430, y: 100, w: 1060, h: 880, cols: 10, colPitch: 96, top: 175, perCol: 12, charPitch: 61, size: 50 };
CARD.right = CARD.x + CARD.w - 50 - CARD.colPitch / 2;

// ---------------------------------------------------------------- 竖排
const PUNCT = '，。、！：；？';
const PAUSE = { '，': 0.28, '、': 0.22, '。': 0.55, '！': 0.55, '：': 0.45, '；': 0.4, '？': 0.55 };

function layoutVertical(paras, o) {
  const out = [];
  let col = -1, row = 0;
  paras.forEach((para, pi) => {
    col++;
    row = (o.indentFirst === false && pi === 0) ? 0 : (o.indent || 0);
    for (const ch of para) {
      const isP = PUNCT.includes(ch);
      if (row >= o.perCol) {
        // 标点不放在行首：悬挂在上一列末尾
        if (!isP) { col++; row = 0; }
      }
      out.push({ ch, col, row, isP, para: pi });
      row++;
    }
  });
  for (const g of out) {
    g.x = o.right - g.col * o.colPitch;
    g.y = o.top + g.row * o.charPitch;
  }
  return out;
}

function timeGlyphs(glyphs, t0, rate, paraPause) {
  let t = t0, para = 0;
  for (const g of glyphs) {
    if (g.para !== para) { t += paraPause; para = g.para; }
    g.t = t;
    t += g.isP ? PAUSE[g.ch] || 0.3 : 1 / rate;
  }
  return t;
}

// ---------------------------------------------------------------- 时间线
const RATE = 5.5;        // 信：每秒写几个字
const GLYPH_DUR = 0.6;   // 每个字晕开的时长
const POEM_RATE = 2.8;
const POEM_GLYPH_DUR = 1.0;

function buildTimeline() {
  const T = { cues: [] };
  const rnd = mulberry32(99);

  // 开场
  const O = T.opening = { start: 0, growStart: 1.2, growEnd: 7.4 };
  O.title = [...C.title].map((ch, i) => ({ ch, x: 880, y: 300 + i * 126, t: 5.4 + i * 0.55 }));
  O.titleSeal = 8.9;
  O.ded = [...C.dedication].map((ch, i) => ({ ch, x: 755, y: 430 + i * 50, t: 9.5 + i * 0.13 }));
  O.fadeOut = [12.0, 13.3];
  O.end = 13.3;
  T.cues.push({ t: O.titleSeal, type: 'seal' });

  // 信
  const L = T.letter = { start: 13.0, cardIn: [13.0, 14.1], pages: [] };
  let cur = 14.1;
  C.letterPages.forEach((paras, pi) => {
    const glyphs = layoutVertical(paras, {
      right: CARD.right, top: CARD.top, colPitch: CARD.colPitch, charPitch: CARD.charPitch,
      perCol: CARD.perCol, indent: 2, indentFirst: pi !== 0
    });
    glyphs.forEach((g, i) => { g.alpha = 0.86 + 0.14 * rnd(); });
    const start = cur;
    const tEnd = timeGlyphs(glyphs, start + 0.15, RATE, 0.6);
    const hold = clamp(2.0 + glyphs.length * 0.03, 2.6, 4.8);
    const last = pi === C.letterPages.length - 1;
    const fade = last ? 1.3 : 0.9;
    const end = tEnd + GLYPH_DUR + hold + fade;
    L.pages.push({ start, end, fade, glyphs });
    cur = end + 0.2;
  });
  L.end = L.pages[L.pages.length - 1].end;  // 最后一页与信笺一起淡出
  L.cardOut = [L.end - 1.3, L.end];

  // 诗
  const P = T.poem = { start: L.end - 0.3, couplets: [] };
  const PO = { right: 1185, top: 250, colPitch: 100, gap: 30, charPitch: 92, size: 78 };
  P.layout = PO;
  let t = P.start + 1.0;
  P.glyphs = [];
  C.poem.forEach((pair, ci) => {
    const cp = { start: t - 0.6 };
    pair.forEach((line, li) => {
      const col = ci * 2 + li;
      const x = PO.right - col * PO.colPitch - ci * PO.gap;
      [...line].forEach((ch, k) => {
        P.glyphs.push({ ch, x, y: PO.top + k * PO.charPitch, t, red: C.poemHighlight.includes(ch), alpha: 0.9 + 0.1 * rnd() });
        t += 1 / POEM_RATE;
      });
      t += li === 0 ? 0.45 : 1.15;
    });
    P.couplets.push(cp);
  });
  P.couplets.forEach((cp, i) => { cp.end = i < 3 ? P.couplets[i + 1].start : Infinity; });
  const sigX = PO.right - 7 * PO.colPitch - 3 * PO.gap - 100;
  t += 0.3;
  P.sig = [];
  let sy = 545;
  for (const ch of C.signature) {
    if (ch === ' ') { sy += 26; continue; }
    P.sig.push({ ch, x: sigX, y: sy, t });
    sy += 52; t += 0.2;
  }
  P.seal = { x: sigX, y: sy + 58, t: t + 0.5 };
  T.cues.push({ t: P.seal.t, type: 'seal' });
  P.end = P.seal.t + 5.0;
  P.fadeOut = [P.end - 1.6, P.end];

  // 结尾
  const E = T.ending = { start: P.end - 0.6 };
  E.small = [...C.endingSmall].map((ch, i) => ({ ch, x: 1075, y: 250 + i * 92, t: E.start + 1.2 + i * 0.5 }));
  E.big = [...C.endingBig].map((ch, i) => ({ ch, x: 880, y: 255 + i * 178, t: E.start + 2.6 + i * 0.75 }));
  E.seal = { x: 745, y: 880, t: E.start + 6.6 };
  E.hbStart = E.start + 1.6;   // 配乐《生日快乐》开始
  E.end = E.start + 31;
  E.fadeOut = [E.end - 4, E.end];
  T.cues.push({ t: E.seal.t, type: 'seal' });
  T.cues.push({ t: E.start, type: 'gliss' });
  T.duration = E.end;
  return T;
}

// ---------------------------------------------------------------- 宣纸
function makePaper() {
  const c = mk(W, H), g = c.getContext('2d');
  const grd = g.createRadialGradient(W * 0.5, H * 0.45, 100, W * 0.5, H * 0.5, W * 0.72);
  grd.addColorStop(0, '#f2e9d6'); grd.addColorStop(0.55, '#ece0c7'); grd.addColorStop(1, '#d6c3a0');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  const r = mulberry32(7);
  for (let i = 0; i < 46; i++) {
    const x = r() * W, y = r() * H, rad = 80 + r() * 320;
    const gg = g.createRadialGradient(x, y, 0, x, y, rad);
    gg.addColorStop(0, `rgba(160,130,80,${0.015 + r() * 0.03})`); gg.addColorStop(1, 'rgba(160,130,80,0)');
    g.fillStyle = gg; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 3200; i++) {
    const x = r() * W, y = r() * H, len = 6 + r() * 38, a = r() * Math.PI * 2;
    g.strokeStyle = r() < 0.55 ? `rgba(120,95,60,${0.03 + r() * 0.05})` : `rgba(255,252,242,${0.08 + r() * 0.1})`;
    g.lineWidth = 0.5 + r() * 0.9;
    g.beginPath(); g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + (r() - 0.5) * 8, y + Math.sin(a) * len * 0.5 + (r() - 0.5) * 8,
      x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 6;
    d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.9;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------- 远山
function makeMountains() {
  const c = mk(W + 160, H), g = c.getContext('2d');
  // peaks: [中心 x, 高度系数, 半宽]
  const layers = [
    { base: 840, amp: 250, f: 0.004, seed: 11, rgb: '74,84,92', a: 0.15, depth: 250, peaks: [[250, 1, 250], [640, 0.72, 210], [1010, 0.45, 170]] },
    { base: 940, amp: 190, f: 0.006, seed: 12, rgb: '56,62,68', a: 0.22, depth: 210, peaks: [[110, 0.9, 220], [500, 0.68, 190], [800, 0.32, 140]] },
    { base: 1040, amp: 125, f: 0.009, seed: 13, rgb: '36,38,42', a: 0.32, depth: 160, peaks: [[30, 1, 200], [350, 0.75, 170]] },
    { base: 1050, amp: 160, f: 0.005, seed: 14, rgb: '74,84,92', a: 0.11, depth: 220, peaks: [[1640, 1, 240], [1920, 0.7, 210]] },
  ];
  for (const L of layers) {
    const n = noise1(L.seed), tex = noise1(L.seed + 50);
    for (let x = -80; x < W + 80; x++) {
      let env = 0;
      for (const [px, k, hw] of L.peaks) env = Math.max(env, k * Math.exp(-(((x - px) / hw) ** 2)));
      if (env < 0.02) continue;
      const h = L.amp * env * (0.6 + 0.6 * fbm(n, x * L.f, 5));
      const y = L.base - h;
      const a = L.a * clamp(env * 2.4) * (0.85 + 0.3 * tex(x * 0.06));
      const gr = g.createLinearGradient(0, y, 0, y + L.depth);
      gr.addColorStop(0, `rgba(${L.rgb},${a})`);
      gr.addColorStop(0.05, `rgba(${L.rgb},${a * 0.8})`);
      gr.addColorStop(0.3, `rgba(${L.rgb},${a * 0.45})`);
      gr.addColorStop(1, `rgba(${L.rgb},0)`);
      g.fillStyle = gr; g.fillRect(x + 80, y, 1, L.depth);
    }
  }
  const out = mk(W + 160, H), og = out.getContext('2d');
  og.filter = 'blur(2px)'; og.drawImage(c, 0, 0);
  return out;
}

// ---------------------------------------------------------------- 梅枝
// 主干与几条大枝手工定构图，小枝和花随机生成
const MAIN_BRANCHES = [
  { id: 'T', pts: [[2000, 875], [1905, 815], [1832, 738], [1752, 690], [1676, 604], [1618, 548]], w0: 50, w1: 30, dry: true, speed: 260 },
  { id: 'B1', parent: 'T', at: 0.78, pts: [[1676, 604], [1612, 478], [1540, 414], [1478, 306], [1395, 245], [1302, 208], [1205, 152], [1120, 128]], w0: 23, w1: 2.5, speed: 230 },
  { id: 'B2', parent: 'T', at: 1.0, pts: [[1618, 548], [1528, 588], [1452, 566], [1386, 606], [1318, 598]], w0: 18, w1: 2.5, speed: 200 },
  { id: 'B3', parent: 'T', at: 0.42, pts: [[1832, 738], [1808, 604], [1838, 482], [1796, 382], [1818, 262], [1776, 152], [1798, 30]], w0: 21, w1: 3, speed: 240 },
  { id: 'B4', parent: 'B1', at: 0.42, pts: [[1478, 306], [1490, 205], [1448, 120], [1468, 48]], w0: 8, w1: 2, speed: 170 },
  { id: 'B5', parent: 'B3', at: 0.36, pts: [[1838, 482], [1742, 432], [1684, 334], [1606, 300]], w0: 9, w1: 2, speed: 170 },
  { id: 'B6', parent: 'B3', at: 0.7, pts: [[1818, 262], [1890, 196], [1950, 170]], w0: 6, w1: 2, speed: 160 },
];

function buildPolyline(pts, rnd) {
  // 折线之间做轻微圆角，再加细小抖动
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.max(2, Math.ceil(len / 2));
    const bow = (rnd() - 0.5) * len * 0.12;
    const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
    for (let k = 0; k < n; k++) {
      const u = k / n;
      const b = Math.sin(Math.PI * u) * bow;
      out.push([x1 + (x2 - x1) * u + nx * b, y1 + (y2 - y1) * u + ny * b]);
    }
  }
  out.push(pts[pts.length - 1]);
  // 平滑一遍，去掉尖角
  const sm = out.map((p, i) => {
    if (i === 0 || i === out.length - 1) return p;
    let sx = 0, sy = 0, c = 0;
    for (let j = Math.max(0, i - 4); j <= Math.min(out.length - 1, i + 4); j++) { sx += out[j][0]; sy += out[j][1]; c++; }
    return [sx / c, sy / c];
  });
  // 重采样为等弧长
  const res = [];
  let acc = 0;
  res.push({ x: sm[0][0], y: sm[0][1], s: 0 });
  for (let i = 1; i < sm.length; i++) {
    const d = Math.hypot(sm[i][0] - sm[i - 1][0], sm[i][1] - sm[i - 1][1]);
    acc += d;
    res.push({ x: sm[i][0], y: sm[i][1], s: acc });
  }
  for (let i = 0; i < res.length; i++) {
    const a = res[Math.max(0, i - 2)], b = res[Math.min(res.length - 1, i + 2)];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    res[i].nx = -dy / l; res[i].ny = dx / l; res[i].dx = dx / l; res[i].dy = dy / l;
  }
  return { samples: res, len: acc };
}

function pointAt(br, s) {
  const S = br.samples;
  let lo = 0, hi = S.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].s < s) lo = m; else hi = m; }
  return S[hi];
}

function buildTree(T) {
  const rnd = mulberry32(2024);
  const branches = [];
  const byId = {};
  for (const m of MAIN_BRANCHES) {
    const pl = buildPolyline(m.pts, rnd);
    const br = { ...m, ...pl, depth: m.parent ? 1 : 0 };
    br.samples.forEach(p => { const u = p.s / br.len; p.w = br.w1 + (br.w0 - br.w1) * Math.pow(1 - u, 0.85); });
    if (m.parent) {
      const par = byId[m.parent];
      br.ts = par.ts + (m.at * par.len) / par.speed;
    } else br.ts = 0;
    byId[m.id] = br;
    branches.push(br);
  }
  // 小枝（嫩枝挺直向上）
  const twigHosts = ['B1', 'B2', 'B3', 'B4', 'B5', 'T'];
  let made = 0, tries = 0;
  while (made < 26 && tries < 400) {
    tries++;
    const host = byId[twigHosts[Math.floor(rnd() * twigHosts.length)]];
    const u = 0.25 + rnd() * 0.7;
    const p = pointAt(host, u * host.len);
    if (p.w > 14 && host.id !== 'T') continue;
    const side = rnd() < 0.5 ? -1 : 1;
    const base = Math.atan2(host.samples[1].dy, host.samples[1].dx);
    let ang = Math.atan2(p.dy, p.dx) + side * (0.5 + rnd() * 0.7);
    // 偏向向上
    ang = Math.atan2(Math.sin(ang) - 0.9, Math.cos(ang));
    const len = 50 + rnd() * 120;
    const pts = [[p.x, p.y]];
    let x = p.x, y = p.y, a = ang;
    const segs = 1 + Math.floor(rnd() * 3);
    let ok = true;
    for (let k = 0; k < segs; k++) {
      const l = len / segs;
      x += Math.cos(a) * l; y += Math.sin(a) * l;
      if (x < 1140 || x > 1960 || y < 30 || y > 1000) { ok = false; break; }
      pts.push([x, y]);
      a += (rnd() - 0.5) * 0.7;
    }
    if (!ok || pts.length < 2) continue;
    const pl = buildPolyline(pts, rnd);
    const w0 = Math.min(p.w * 0.55, 3.2 + rnd() * 2);
    const br = { id: 'tw' + made, twig: true, ...pl, w0, w1: 1.4, speed: 150, depth: 2 };
    br.samples.forEach(q => { const uu = q.s / br.len; q.w = br.w1 + (br.w0 - br.w1) * (1 - uu); });
    br.ts = host.ts + (u * host.len) / host.speed;
    branches.push(br);
    made++;
  }
  // 归一化生长时间
  let maxEnd = 0;
  for (const b of branches) maxEnd = Math.max(maxEnd, b.ts + b.len / b.speed);
  const O = T.opening, k = (O.growEnd - O.growStart) / maxEnd;
  for (const b of branches) { b.ts = O.growStart + b.ts * k; b.speed /= k; }

  // 花
  const blossoms = [];
  const avoid = (x, y) => blossoms.some(b => Math.hypot(b.x - x, b.y - y) < 30);
  for (const b of branches) {
    if (b.id === 'T') continue;
    const count = b.twig ? 1 + Math.floor(rnd() * 3) : Math.floor(b.len / 75);
    for (let i = 0; i < count; i++) {
      let u = b.twig ? 0.35 + rnd() * 0.65 : 0.12 + rnd() * 0.88;
      if (i === 0) u = 0.97;
      const p = pointAt(b, u * b.len);
      const off = (rnd() - 0.5) * 14;
      const x = p.x + p.nx * off, y = p.y + p.ny * off;
      if (avoid(x, y)) continue;
      const tip = u > 0.93;
      const roll = rnd();
      const type = tip && roll < 0.55 ? 'bud' : roll < 0.68 ? 'full' : roll < 0.88 ? 'half' : 'bud';
      blossoms.push({
        x, y, type,
        r: type === 'bud' ? 16 + rnd() * 6 : 20 + rnd() * 10,
        rot: rnd() * Math.PI * 2, tilt: rnd() * Math.PI, squash: type === 'half' ? 0.62 : 0.75 + rnd() * 0.25,
        tb: b.ts + (u * b.len) / b.speed + 0.25 + rnd() * 0.9,
        seed: Math.floor(rnd() * 1e9),
        late: false,
      });
    }
  }
  // 部分花苞在结尾盛开
  blossoms.forEach(b => {
    if (b.type === 'bud' && rnd() < 0.7) { b.late = true; b.type = 'full'; b.tLate = T.ending.start + 0.4 + rnd() * 3.2; }
  });
  // 少量花开在老干上，点缀
  for (const s of [0.55, 0.9]) {
    const tr = byId.T, p = pointAt(tr, s * tr.len);
    blossoms.push({ x: p.x + p.nx * 28, y: p.y + p.ny * 28, type: 'half', r: 22, rot: 1, tilt: 0.5, squash: 0.62,
      tb: tr.ts + s * tr.len / tr.speed + 1.5, seed: 77 + s * 100, late: false });
  }
  // 苔点
  const moss = [];
  for (const id of ['T', 'B1', 'B3']) {
    const br = byId[id];
    const n = id === 'T' ? 9 : 5;
    for (let i = 0; i < n; i++) {
      const u = id === 'T' ? 0.15 + rnd() * 0.8 : 0.08 + rnd() * 0.45;
      const p = pointAt(br, u * br.len);
      const side = p.ny < 0 ? 1 : -1;  // 偏向枝的上沿
      const cx = p.x + p.nx * p.w * 0.55 * side, cy = p.y + p.ny * p.w * 0.55 * side;
      const k = 1 + Math.floor(rnd() * 3);
      for (let j = 0; j < k; j++) {
        moss.push({ x: cx + (rnd() - 0.5) * 16, y: cy + (rnd() - 0.5) * 10, r: 2 + rnd() * 4.5, rot: rnd() * 3, t: O.growEnd - 0.5 + rnd() * 1.2 });
      }
    }
  }
  return { branches, blossoms, moss, byId };
}

// 笔触：先以浓墨写出枝形，边缘略重；老干再用“干笔”擦出飞白。
// g 必须是单独的图层（飞白用 destination-out 擦除）。
function branchEdges(br, grown) {
  const S = br.samples, Lp = [], Rp = [];
  const wn = br._wn || (br._wn = noise1(500 + br.id.charCodeAt(br.id.length - 1) * 13 + br.id.length));
  for (const p of S) {
    if (p.s > grown) break;
    const rem = grown - p.s;
    let w = p.w * (0.86 + 0.28 * wn(p.s * 0.035));
    if (grown < br.len && rem < 60) w *= 0.12 + 0.88 * Math.sqrt(rem / 60);
    else if (!br.dry && br.len - p.s < 14) w *= 0.45 + 0.55 * (br.len - p.s) / 14;
    p.cw = w;
    Lp.push([p.x + p.nx * w / 2, p.y + p.ny * w / 2]);
    Rp.push([p.x - p.nx * w / 2, p.y - p.ny * w / 2]);
  }
  return [Lp, Rp];
}

function drawBranch(g, br, grown) {
  if (grown <= 0) return;
  const [Lp, Rp] = branchEdges(br, grown);
  if (Lp.length < 2) return;
  g.save();
  g.fillStyle = INK; g.strokeStyle = INK;
  g.globalAlpha = br.dry ? 0.8 : br.w0 > 6 ? 0.9 : 0.94;
  g.beginPath();
  g.moveTo(Lp[0][0], Lp[0][1]);
  for (const q of Lp) g.lineTo(q[0], q[1]);
  for (let i = Rp.length - 1; i >= 0; i--) g.lineTo(Rp[i][0], Rp[i][1]);
  g.closePath(); g.fill();
  // 收笔圆头
  const last = br.samples[Lp.length - 1];
  g.beginPath(); g.arc(last.x, last.y, last.cw / 2, 0, 6.2832); g.fill();
  if (br.w0 > 6) {
    g.globalAlpha = br.dry ? 0.75 : 0.5;
    g.lineWidth = Math.max(1.2, br.w0 * (br.dry ? 0.1 : 0.07));
    g.lineJoin = 'round';
    for (const side of [Lp, Rp]) {
      g.beginPath(); side.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.stroke();
    }
  }
  if (br.w0 > 12) {
    // 飞白
    g.globalCompositeOperation = 'destination-out';
    g.lineCap = 'round';
    const K = br.dry ? 14 : 6;
    const S = br.samples;
    for (let k = 0; k < K; k++) {
      const n = noise1(900 + k * 7 + br.id.length * 3);
      const u = -0.72 + 1.44 * (k + 0.5) / K;
      const thr = br.dry ? 0.5 : 0.6;
      g.globalAlpha = br.dry ? 0.55 + 0.35 * ((k * 37) % 10) / 10 : 0.35;
      g.lineWidth = br.dry ? 1.2 + ((k * 53) % 10) / 10 * 2.2 : 1.2;
      g.beginPath();
      let on = false;
      for (let i = 0; i < Lp.length; i += 2) {
        const p = S[i];
        const vis = fbm(n, p.s * 0.012 + k * 5.3, 3) > thr && p.s > 6;
        const x = p.x + p.nx * u * p.cw / 2, y = p.y + p.ny * u * p.cw / 2;
        if (vis) { on ? g.lineTo(x, y) : g.moveTo(x, y); on = true; } else on = false;
      }
      g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
  }
  g.restore();
}

function drawMoss(g, moss, t) {
  for (const m of moss) {
    const p = ramp(t, m.t, m.t + 0.5);
    if (p <= 0) continue;
    g.globalAlpha = 0.9 * p;
    g.fillStyle = INK;
    g.beginPath(); g.ellipse(m.x, m.y, m.r, m.r * 0.7, m.rot, 0, 6.2832); g.fill();
  }
  g.globalAlpha = 1;
}

// ---------------------------------------------------------------- 梅花
const RED = { inner: [226, 78, 92], outer: [178, 24, 50] };
const PINK = { inner: [240, 170, 172], outer: [214, 120, 128] };

function drawBlossom(g, b, q, opt = {}) {
  if (q <= 0) return;
  const col = opt.color || RED;
  const alpha = opt.alpha == null ? 1 : opt.alpha;
  const r = b.r;
  const rnd = mulberry32(b.seed);
  const jit = Array.from({ length: 8 }, () => rnd());
  const maxOpen = b.type === 'half' ? 0.42 : 1;
  const scale = q < 0.3 ? 0.35 + 0.65 * easeOut(q / 0.3) : 1;
  const open = b.type === 'bud' ? 0 : maxOpen * easeOut(ramp(q, 0.3, 1));
  g.save();
  g.translate(b.x, b.y);
  g.rotate(b.tilt);
  g.scale(scale, scale * b.squash);
  g.rotate(-b.tilt + b.rot);
  g.globalAlpha = alpha * clamp(q * 4);
  g.globalCompositeOperation = 'multiply';
  const [ir, ig, ib] = col.inner, [or, og, ob] = col.outer;
  if (b.type === 'bud') {
    const rr = r * 0.42;
    if (b.knock) {
      g.globalCompositeOperation = 'source-over'; g.fillStyle = b.knock;
      g.beginPath(); g.arc(0, 0, rr * 0.96, 0, 6.2832); g.fill();
      g.globalCompositeOperation = 'multiply';
    }
    const gr = g.createRadialGradient(-rr * 0.3, -rr * 0.3, 0, 0, 0, rr);
    gr.addColorStop(0, `rgba(${ir},${ig},${ib},0.95)`); gr.addColorStop(1, `rgba(${or},${og},${ob},0.95)`);
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rr, 0, 6.2832); g.fill();
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = `rgba(40,28,22,${0.85 * alpha})`;
    for (let k = 0; k < 3; k++) {
      const a = Math.PI * 0.5 + (k - 1) * 0.7;
      g.beginPath(); g.ellipse(Math.cos(a) * rr * 0.85, Math.sin(a) * rr * 0.85, rr * 0.32, rr * 0.2, a, 0, 6.2832); g.fill();
    }
    g.restore();
    return;
  }
  const d = r * (0.14 + 0.38 * open), pr = r * (0.3 + 0.25 * open);
  if (b.knock) {
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = b.knock;
    for (let k = 0; k < 5; k++) {
      const a = k * Math.PI * 2 / 5 + (jit[k] - 0.5) * 0.25;
      g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, pr * (0.9 + jit[(k + 3) % 8] * 0.2) * 0.96, 0, 6.2832); g.fill();
    }
    g.globalCompositeOperation = 'multiply';
  }
  for (let k = 0; k < 5; k++) {
    const a = k * Math.PI * 2 / 5 + (jit[k] - 0.5) * 0.25;
    const cx = Math.cos(a) * d, cy = Math.sin(a) * d;
    const rr = pr * (0.9 + jit[(k + 3) % 8] * 0.2);
    const gr = g.createRadialGradient(cx * 0.4, cy * 0.4, rr * 0.1, cx, cy, rr);
    gr.addColorStop(0, `rgba(${ir},${ig},${ib},0.78)`);
    gr.addColorStop(0.75, `rgba(${(ir + or) >> 1},${(ig + og) >> 1},${(ib + ob) >> 1},0.82)`);
    gr.addColorStop(1, `rgba(${or},${og},${ob},0.9)`);
    g.fillStyle = gr;
    g.beginPath(); g.arc(cx, cy, rr, 0, 6.2832); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  if (open > 0.35) {
    const so = smooth((open - 0.35) / 0.5);
    g.globalAlpha = alpha * so;
    g.fillStyle = 'rgba(246,226,160,0.9)';
    g.beginPath(); g.arc(0, 0, r * 0.17, 0, 6.2832); g.fill();
    const ns = 11;
    for (let k = 0; k < ns; k++) {
      const a = k * Math.PI * 2 / ns + jit[k % 8] * 0.4;
      const l = r * (0.5 + 0.22 * jit[(k + 2) % 8]) * so;
      const ex = Math.cos(a) * l, ey = Math.sin(a) * l;
      g.strokeStyle = 'rgba(96,30,26,0.6)'; g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(Math.cos(a) * r * 0.12, Math.sin(a) * r * 0.12);
      g.quadraticCurveTo(Math.cos(a + 0.15) * l * 0.6, Math.sin(a + 0.15) * l * 0.6, ex, ey); g.stroke();
      g.fillStyle = 'rgba(232,186,48,0.95)';
      g.beginPath(); g.arc(ex, ey, 1.9, 0, 6.2832); g.fill();
      g.fillStyle = 'rgba(60,30,18,0.55)';
      g.beginPath(); g.arc(ex + 0.7, ey - 0.7, 0.9, 0, 6.2832); g.fill();
    }
  }
  g.restore();
}

function blossomQ(b, t) {
  if (b.late) return 0.3 * ramp(t, b.tb, b.tb + 1.0) + 0.7 * easeOut(ramp(t, b.tLate, b.tLate + 1.8));
  return ramp(t, b.tb, b.tb + 1.9);
}

// ---------------------------------------------------------------- 印章
function makeSeal(text) {
  // 白文方印：朱底，字留白
  const rnd = mulberry32(text.charCodeAt(0) * 31 + text.length);
  const w = 92, h = 160, fs = 66;
  const c = mk(w + 20, h + 20), g = c.getContext('2d');
  g.translate(10, 10);
  g.fillStyle = CINNABAR;
  g.beginPath(); g.roundRect(0, 0, w, h, 6); g.fill();
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000';
  g.font = `${fs}px ${FONT.brush}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  [...text].forEach((ch, i) => {
    g.save(); g.translate(w / 2, h * (0.27 + 0.46 * i)); g.scale(1.05, 1.08); g.fillText(ch, 0, 0); g.restore();
  });
  // 斑驳
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 260; i++) {
    const edge = rnd() < 0.6;
    let x, y;
    if (edge) {
      const s = rnd() * 4;
      x = s < 1 ? rnd() * w : s < 2 ? rnd() * w : s < 3 ? 0 : w;
      y = s < 1 ? 0 : s < 2 ? h : rnd() * h;
      x += (rnd() - 0.5) * 6; y += (rnd() - 0.5) * 6;
    } else { x = rnd() * w; y = rnd() * h; }
    g.globalAlpha = 0.3 + rnd() * 0.7;
    g.beginPath(); g.arc(x, y, 0.6 + rnd() * (edge ? 3 : 1.8), 0, 6.2832); g.fill();
  }
  return c;
}

function drawSeal(g, img, x, y, p, scale = 1) {
  if (p <= 0) return;
  const s = scale * (p < 0.5 ? lerp(1.35, 0.97, easeOut(p / 0.5)) : lerp(0.97, 1, smooth((p - 0.5) / 0.5)));
  g.save();
  g.globalAlpha = clamp(p * 2.2) * 0.92;
  g.globalCompositeOperation = 'multiply';
  g.translate(x, y); g.scale(s, s);
  g.drawImage(img, -img.width / 2, -img.height / 2);
  g.restore();
}

// ---------------------------------------------------------------- 写字（墨迹自上而下晕开）
const gbuf = mk(420, 420), gb = gbuf.getContext('2d');
function glyphOffset(ch, size) {
  if ('，。、'.includes(ch)) return { dx: size * 0.58, dy: -size * 0.5, rot: 0 };
  if ('：；'.includes(ch)) return { dx: 0, dy: 0, rot: Math.PI / 2 };
  return { dx: 0, dy: 0, rot: 0 };
}
function inkGlyph(g, ch, x, y, font, size, color, p, alpha = 1, blurMax = 3) {
  if (p <= 0) return;
  const o = glyphOffset(ch, size);
  if (p >= 1) {
    g.save();
    g.globalAlpha *= alpha;
    g.fillStyle = color; g.font = `${size}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.translate(x + o.dx, y + o.dy); if (o.rot) g.rotate(o.rot);
    g.fillText(ch, 0, 0);
    g.restore();
    return;
  }
  const S = Math.ceil(size * 1.6);
  gb.setTransform(1, 0, 0, 1, 0, 0);
  gb.globalCompositeOperation = 'source-over';
  gb.clearRect(0, 0, S + 2, S + 2);
  gb.fillStyle = color; gb.font = `${size}px ${font}`; gb.textAlign = 'center'; gb.textBaseline = 'middle';
  gb.save(); gb.translate(S / 2, S / 2); if (o.rot) gb.rotate(o.rot); gb.fillText(ch, 0, 0); gb.restore();
  const soft = 0.45, e = p * (1 + soft);
  const top = (S - size) / 2;
  const grd = gb.createLinearGradient(0, top + (e - soft) * size, 0, top + e * size + 0.01);
  grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  gb.globalCompositeOperation = 'destination-in';
  gb.fillStyle = grd; gb.fillRect(0, 0, S, S);
  gb.globalCompositeOperation = 'source-over';
  g.save();
  g.globalAlpha *= alpha * clamp(p * 1.8);
  const bl = (1 - p) * blurMax;
  if (bl > 0.15) g.filter = `blur(${bl.toFixed(2)}px)`;
  const sc = 1 + (1 - p) * 0.05;
  g.translate(x + o.dx, y + o.dy); g.scale(sc, sc);
  g.drawImage(gbuf, 0, 0, S, S, -S / 2, -S / 2, S, S);
  g.restore();
}

function drawGlyphs(g, glyphs, t, font, size, dur, color, blurMax) {
  for (const gl of glyphs) {
    const p = ramp(t, gl.t, gl.t + dur);
    if (p <= 0) continue;
    inkGlyph(g, gl.ch, gl.x, gl.y, font, size, gl.red ? CINNABAR : color, p, gl.alpha || 1, blurMax);
  }
}

// ---------------------------------------------------------------- 信笺
function makeCard(tree) {
  const pad = 40;
  const c = mk(CARD.w + pad * 2, CARD.h + pad * 2), g = c.getContext('2d');
  g.translate(pad, pad);
  g.shadowColor = 'rgba(60,40,20,0.28)'; g.shadowBlur = 30; g.shadowOffsetY = 10;
  g.fillStyle = '#f6efdf';
  g.fillRect(0, 0, CARD.w, CARD.h);
  g.shadowColor = 'transparent';
  const r = mulberry32(5);
  for (let i = 0; i < 900; i++) {
    const x = r() * CARD.w, y = r() * CARD.h, l = 5 + r() * 26, a = r() * 6.28;
    g.strokeStyle = r() < 0.5 ? `rgba(140,110,70,${0.03 + r() * 0.04})` : `rgba(255,255,250,${0.1 + r() * 0.1})`;
    g.lineWidth = 0.6;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  // 梅花笺：左下角淡淡一枝
  g.save();
  g.globalAlpha = 0.5;
  g.strokeStyle = 'rgba(150,120,110,0.55)'; g.lineCap = 'round';
  const twig = [[30, 860], [90, 790], [120, 740], [190, 700], [230, 650]];
  g.lineWidth = 5; g.beginPath(); twig.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
  g.lineWidth = 3; g.beginPath(); g.moveTo(120, 740); g.lineTo(110, 670); g.lineTo(130, 620); g.stroke();
  g.lineWidth = 2.5; g.beginPath(); g.moveTo(190, 700); g.lineTo(260, 720); g.stroke();
  const flowers = [[232, 646, 22], [128, 616, 20], [262, 722, 17], [96, 786, 19], [168, 712, 15], [110, 668, 13]];
  flowers.forEach(([x, y, rr], i) => drawBlossom(g, { x, y, r: rr, type: i % 4 === 3 ? 'half' : 'full', rot: i, tilt: i * 0.7, squash: 0.85, seed: 300 + i }, 1, { color: PINK, alpha: 0.75 }));
  g.restore();
  // 朱丝栏
  g.strokeStyle = 'rgba(178,52,48,0.42)'; g.lineWidth = 1.4;
  const left = CARD.w - 50 - CARD.cols * CARD.colPitch;
  g.strokeRect(left, 50, CARD.cols * CARD.colPitch, CARD.h - 100);
  g.lineWidth = 1;
  for (let i = 1; i < CARD.cols; i++) {
    const x = left + i * CARD.colPitch;
    g.beginPath(); g.moveTo(x, 50); g.lineTo(x, CARD.h - 50); g.stroke();
  }
  g.lineWidth = 2.2; g.strokeStyle = 'rgba(178,52,48,0.32)';
  g.strokeRect(left - 6, 44, CARD.cols * CARD.colPitch + 12, CARD.h - 88);
  return { img: c, pad };
}

// ---------------------------------------------------------------- 飘落物（花瓣、桂花、雪、金光）
function makeParticles(T, tree) {
  const rnd = mulberry32(31337);
  const P = T.poem, E = T.ending;
  const cp = P.couplets;
  const sources = tree.blossoms.filter(b => b.type !== 'bud');
  const list = { petals: [], gui: [], snow: [], spark: [] };
  // 速率函数（每秒个数）
  const petalRate = t =>
    t < T.opening.growEnd ? 0 :
    t < T.letter.end ? 0.22 :
    t < cp[1].start ? 0.35 :
    t < cp[2].start ? 1.1 :
    t < E.start ? 0.45 :
    0.6 + 1.6 * ramp(t, E.start, E.start + 6);
  const guiRate = t => 0.5 * win(t, 2, T.opening.end, 2, 1) + 7 * win(t, cp[0].start, cp[1].start + 1, 1.5, 2) + 1.2 * win(t, E.start + 2, T.duration, 2, 2);
  const snowRate = t => 30 * win(t, cp[1].start, cp[2].start + 0.5, 1.5, 2.5);
  const sparkRate = t => 5 * win(t, cp[2].start, cp[3].start, 1.5, 1.5) + 7 * win(t, cp[3].start, T.duration, 1.5, 3);
  const spawn = (rate, fn) => {
    const maxR = 40;
    for (let t = 0; t < T.duration; ) {
      t += -Math.log(1 - rnd()) / maxR;
      if (rnd() * maxR < rate(t)) fn(t);
    }
  };
  spawn(petalRate, t => {
    const s = sources[Math.floor(rnd() * sources.length)];
    list.petals.push({ t0: t, x: s.x + (rnd() - 0.5) * 20, y: s.y, vx: -18 - rnd() * 40, vy: 32 + rnd() * 34,
      amp: 18 + rnd() * 34, f: 0.35 + rnd() * 0.5, ph: rnd() * 6.28, spin: (rnd() - 0.5) * 4, flip: 1.5 + rnd() * 2.5,
      r: 6 + rnd() * 4, life: 26 });
  });
  spawn(guiRate, t => {
    list.gui.push({ t0: t, x: 1940 + rnd() * 60, y: -60 + rnd() * 760, vx: -70 - rnd() * 90, vy: 14 + rnd() * 30,
      amp: 10 + rnd() * 20, f: 0.4 + rnd() * 0.8, ph: rnd() * 6.28, spin: (rnd() - 0.5) * 5, r: 3.6 + rnd() * 3, life: 32 });
  });
  spawn(snowRate, t => {
    list.snow.push({ t0: t, x: rnd() * (W + 300), y: -20, vx: -16 - rnd() * 16, vy: 36 + rnd() * 40,
      amp: 6 + rnd() * 14, f: 0.3 + rnd() * 0.6, ph: rnd() * 6.28, r: 2.2 + rnd() * 3.6, life: 30 });
  });
  spawn(sparkRate, t => {
    const s = rnd() < 0.6 ? sources[Math.floor(rnd() * sources.length)] : { x: 300 + rnd() * 1500, y: 80 + rnd() * 900 };
    list.spark.push({ t0: t, x: s.x + (rnd() - 0.5) * 120, y: s.y + (rnd() - 0.5) * 120, r: 5 + rnd() * 9, life: 1.4 + rnd() * 1.4, rot: rnd() });
  });
  return list;
}

function drawPetal(g, x, y, r, rot, flip, alpha) {
  g.save();
  g.translate(x, y); g.rotate(rot); g.scale(0.25 + 0.75 * Math.abs(flip), 1);
  g.globalAlpha = alpha;
  g.globalCompositeOperation = 'multiply';
  const gr = g.createRadialGradient(-r * 0.2, -r * 0.2, 0, 0, 0, r);
  gr.addColorStop(0, 'rgba(228,86,100,0.85)'); gr.addColorStop(1, 'rgba(180,26,52,0.9)');
  g.fillStyle = gr;
  g.beginPath(); g.ellipse(0, 0, r, r * 0.82, 0, 0, 6.2832); g.fill();
  g.restore();
}

function drawParticles(g, list, t) {
  for (const p of list.petals) {
    const a = t - p.t0;
    if (a < 0 || a > p.life) continue;
    const x = p.x + p.vx * a + p.amp * Math.sin(p.f * a * 6.28 + p.ph);
    const y = p.y + p.vy * a + 6 * Math.sin(p.f * 2 * a * 6.28);
    if (y > H + 20 || x < -30) continue;
    drawPetal(g, x, y, p.r, p.ph + p.spin * a, Math.cos(p.flip * a + p.ph), clamp(a * 2) * 0.9);
  }
  for (const p of list.gui) {
    const a = t - p.t0;
    if (a < 0 || a > p.life) continue;
    const x = p.x + p.vx * a + p.amp * Math.sin(p.f * a * 6.28 + p.ph);
    const y = p.y + p.vy * a + p.amp * 0.5 * Math.cos(p.f * a * 6.28);
    if (x < -20 || y > H + 20) continue;
    g.save(); g.translate(x, y); g.rotate(p.ph + p.spin * a);
    g.fillStyle = 'rgba(226,160,40,0.92)';
    for (let k = 0; k < 4; k++) {
      g.rotate(Math.PI / 2);
      g.beginPath(); g.ellipse(p.r * 0.55, 0, p.r * 0.6, p.r * 0.42, 0, 0, 6.2832); g.fill();
    }
    g.fillStyle = 'rgba(190,110,20,0.9)'; g.beginPath(); g.arc(0, 0, p.r * 0.25, 0, 6.2832); g.fill();
    g.restore();
  }
  if (list.snow.length) {
    for (const p of list.snow) {
      const a = t - p.t0;
      if (a < 0 || a > p.life) continue;
      const x = p.x + p.vx * a + p.amp * Math.sin(p.f * a * 6.28 + p.ph);
      const y = p.y + p.vy * a;
      if (y > H + 10 || x < -10) continue;
      const fade = clamp(a * 1.5) * clamp((H + 10 - y) / 200 + 0.3);
      g.globalAlpha = fade * 0.35;
      g.fillStyle = 'rgba(96,106,120,0.5)';
      g.beginPath(); g.arc(x + 0.5, y + 0.7, p.r * 1.25, 0, 6.2832); g.fill();
      g.globalAlpha = fade;
      const sg = g.createRadialGradient(x, y, 0, x, y, p.r);
      sg.addColorStop(0, 'rgba(255,255,252,1)'); sg.addColorStop(0.6, 'rgba(255,253,246,0.9)'); sg.addColorStop(1, 'rgba(255,253,246,0)');
      g.fillStyle = sg;
      g.beginPath(); g.arc(x, y, p.r, 0, 6.2832); g.fill();
    }
    g.globalAlpha = 1;
  }
  for (const p of list.spark) {
    const a = t - p.t0;
    if (a < 0 || a > p.life) continue;
    const k = Math.sin(Math.PI * a / p.life);
    const r = p.r * (0.6 + 0.4 * k);
    g.save(); g.translate(p.x, p.y); g.rotate(p.rot + a * 0.3);
    g.globalAlpha = k * 0.85;
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, r * 1.6);
    gr.addColorStop(0, 'rgba(255,236,170,0.9)'); gr.addColorStop(1, 'rgba(255,210,120,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r * 1.6, 0, 6.2832); g.fill();
    g.fillStyle = 'rgba(214,160,50,0.95)';
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const rr = i % 2 ? r * 0.18 : r;
      const an = i * Math.PI / 4;
      i ? g.lineTo(Math.cos(an) * rr, Math.sin(an) * rr) : g.moveTo(rr, 0);
    }
    g.closePath(); g.fill();
    g.restore();
  }
  g.globalAlpha = 1;
}

// ---------------------------------------------------------------- 月
function drawMoon(g, alpha, glow) {
  if (alpha <= 0) return;
  const { x, y, r } = MOON;
  g.save();
  g.globalAlpha = alpha;
  // 烘云托月：月外淡墨晕染，月内留白
  const h = g.createRadialGradient(x, y, r, x, y, r * 2.9);
  h.addColorStop(0, 'rgba(92,100,112,0.2)');
  h.addColorStop(0.18, 'rgba(92,100,112,0.11)');
  h.addColorStop(1, 'rgba(92,100,112,0)');
  g.fillStyle = h;
  g.beginPath(); g.arc(x, y, r * 2.9, 0, 6.2832); g.arc(x, y, r, 0, 6.2832, true); g.fill();
  const m = g.createRadialGradient(x - r * 0.25, y - r * 0.25, r * 0.1, x, y, r);
  m.addColorStop(0, '#fbf8ef'); m.addColorStop(1, '#f3ebd8');
  g.fillStyle = m; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
  if (glow > 0) {
    g.globalAlpha = alpha * glow;
    const gl = g.createRadialGradient(x, y, r * 0.9, x, y, r * 4.5);
    gl.addColorStop(0, 'rgba(246,206,120,0.45)'); gl.addColorStop(0.4, 'rgba(246,206,120,0.14)'); gl.addColorStop(1, 'rgba(246,206,120,0)');
    g.fillStyle = gl; g.fillRect(x - r * 4.5, y - r * 4.5, r * 9, r * 9);
  }
  g.restore();
}

function drawRays(g, k, t) {
  if (k <= 0) return;
  const { x, y, r } = MOON;
  g.save();
  g.globalCompositeOperation = 'screen';
  for (let i = 0; i < 9; i++) {
    const a = 0.05 + i * 0.16 + Math.sin(t * 0.25 + i) * 0.03;
    const len = 1500, wd = 0.035 + 0.02 * Math.sin(i * 2.1);
    const gr = g.createLinearGradient(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len);
    gr.addColorStop(0, `rgba(255,224,150,${0.22 * k})`); gr.addColorStop(1, 'rgba(255,224,150,0)');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    g.lineTo(x + Math.cos(a - wd) * len, y + Math.sin(a - wd) * len);
    g.lineTo(x + Math.cos(a + wd) * len, y + Math.sin(a + wd) * len);
    g.closePath(); g.fill();
  }
  g.restore();
}

// ---------------------------------------------------------------- 主渲染
let T, tree, paper, mountains, card, parts, branchCache, branchLayer, seals;

function render(t) {
  const g = ctx;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
  g.drawImage(paper, 0, 0);

  const O = T.opening, L = T.letter, P = T.poem, E = T.ending;
  const cp = P.couplets;

  // 远山，缓缓平移
  g.globalAlpha = smooth(ramp(t, 0.4, 4.5));
  g.drawImage(mountains, -80 - 50 * (t / T.duration), 0);
  g.globalAlpha = 1;

  // 冷色淡墨（雪）与暖光
  const coolK = win(t, cp[1].start, cp[2].start + 0.5, 1.5, 2);
  if (coolK > 0) { g.fillStyle = `rgba(70,84,100,${0.13 * coolK})`; g.fillRect(0, 0, W, H); }
  const lightK = win(t, cp[2].start, cp[3].start + 1, 1.8, 2.5);
  const endGlow = 0.6 * win(t, E.start + 1, T.duration, 3, 4);
  drawMoon(g, smooth(ramp(t, 1.0, 4.0)), Math.max(lightK, endGlow, 0.25 * win(t, cp[3].start, P.end, 2, 2)));
  drawRays(g, lightK, t);

  // 梅枝
  if (t >= O.growEnd + 0.1) {
    g.drawImage(branchCache, 0, 0);
  } else if (t > O.growStart) {
    const lg = branchLayer.getContext('2d');
    lg.clearRect(0, 0, W, H);
    for (const br of tree.branches) drawBranch(lg, br, (t - br.ts) * br.speed);
    g.drawImage(branchLayer, 0, 0);
  }
  drawMoss(g, tree.moss, t);
  for (const b of tree.blossoms) drawBlossom(g, b, blossomQ(b, t));

  // 题字
  const titleA = 1 - smooth(ramp(t, O.fadeOut[0], O.fadeOut[1]));
  if (titleA > 0 && t > 4) {
    g.save(); g.globalAlpha = titleA;
    drawGlyphs(g, O.title, t, FONT.brush, 112, 1.1, INK, 4);
    drawGlyphs(g, O.ded, t, FONT.kai, 38, 0.7, '#4a3f35', 2);
    drawSeal(g, seals.name, 880, 300 + 5 * 126 + 30, ramp(t, O.titleSeal, O.titleSeal + 0.45), 0.8);
    g.restore();
  }

  // 诗
  const poemA = 1 - smooth(ramp(t, P.fadeOut[0], P.fadeOut[1]));
  if (t > P.start && poemA > 0) {
    g.save(); g.globalAlpha = poemA;
    drawGlyphs(g, P.glyphs, t, FONT.brush, P.layout.size, POEM_GLYPH_DUR, INK, 4);
    drawGlyphs(g, P.sig, t, FONT.brush, 40, 0.6, '#2e2823', 2);
    drawSeal(g, seals.name, P.seal.x, P.seal.y, ramp(t, P.seal.t, P.seal.t + 0.45), 0.62);
    g.restore();
  }

  // 结尾
  if (t > E.start) {
    const endA = 1;
    g.save(); g.globalAlpha = endA;
    drawGlyphs(g, E.small, t, FONT.xing, 76, 0.9, '#2b2520', 3);
    drawGlyphs(g, E.big, t, FONT.brush, 158, 1.3, INK, 5);
    drawSeal(g, seals.name, E.seal.x, E.seal.y, ramp(t, E.seal.t, E.seal.t + 0.45), 0.8);
    g.restore();
  }

  // 信笺
  const cardA = smooth(ramp(t, L.cardIn[0], L.cardIn[1])) * (1 - smooth(ramp(t, L.cardOut[0], L.cardOut[1])));
  if (cardA > 0) {
    const dy = (1 - smooth(ramp(t, L.cardIn[0], L.cardIn[1]))) * 30 - smooth(ramp(t, L.cardOut[0], L.cardOut[1])) * 20;
    g.save();
    g.globalAlpha = cardA;
    g.translate(0, dy);
    g.drawImage(card.img, CARD.x - card.pad, CARD.y - card.pad);
    for (const pg of L.pages) {
      if (t < pg.start || t > pg.end) continue;
      g.save();
      g.globalAlpha = cardA * (1 - smooth(ramp(t, pg.end - pg.fade, pg.end)));
      drawGlyphs(g, pg.glyphs, t, FONT.kai, CARD.size, GLYPH_DUR, INK, 2.5);
      g.restore();
    }
    g.restore();
  }

  drawParticles(g, parts, t);

  // 黑场
  const fade = Math.max(1 - smooth(ramp(t, 0, 1.8)), smooth(ramp(t, E.fadeOut[0], E.fadeOut[1])));
  if (fade > 0) { g.globalAlpha = fade; g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
}

// ---------------------------------------------------------------- 初始化
async function init() {
  const fonts = [[FONT.brush, 'fonts/mashanzheng.woff2'], [FONT.xing, 'fonts/zhimangxing.woff2'], [FONT.kai, 'fonts/wenkai.woff2']];
  await Promise.all(fonts.map(async ([name, url]) => {
    const f = new FontFace(name, `url(${url})`);
    await f.load(); document.fonts.add(f);
  }));
  T = buildTimeline();
  tree = buildTree(T);
  paper = makePaper();
  mountains = makeMountains();
  card = makeCard(tree);
  parts = makeParticles(T, tree);
  seals = { name: makeSeal(C.sealName) };
  branchCache = mk(W, H);
  branchLayer = mk(W, H);
  const bc = branchCache.getContext('2d');
  for (const br of tree.branches) drawBranch(bc, br, br.len + 1);
  // 花下“留白”：用花所在处的纸色先垫底，免得花瓣与墨枝叠成黑色
  const pg = paper.getContext('2d');
  for (const b of tree.blossoms) {
    const d = pg.getImageData(Math.round(clamp(b.x, 0, W - 1)), Math.round(clamp(b.y, 0, H - 1)), 1, 1).data;
    b.knock = `rgb(${d[0]},${d[1]},${d[2]})`;
  }
  render(0);
}

const ready = init();
window.FILM = {
  W, H,
  ready,
  render: t => render(t),
  get duration() { return T.duration; },
  timeline: () => ({
    duration: T.duration,
    opening: { start: 0, end: T.opening.end, titleSeal: T.opening.titleSeal },
    letter: { start: T.letter.start, end: T.letter.end, pages: T.letter.pages.map(p => ({ start: p.start, end: p.end })) },
    poem: { start: T.poem.start, end: T.poem.end, couplets: T.poem.couplets.map(c => c.start), seal: T.poem.seal.t },
    ending: { start: T.ending.start, hbStart: T.ending.hbStart, seal: T.ending.seal.t, end: T.ending.end },
    cues: T.cues,
  }),
};
})();
