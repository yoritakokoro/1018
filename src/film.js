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
const easeInOut = t => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
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

  // 开场：卷轴展开 → 镜头推近 → 梅枝生长 → 题字
  const O = T.opening = { start: 0, unroll: [1.0, 4.2], push: [3.8, 6.4], growStart: 4.6, growEnd: 10.6 };
  O.title = [...C.title].map((ch, i) => ({ ch, x: 880, y: 300 + i * 126, t: 8.6 + i * 0.55 }));
  O.titleSeal = 12.1;
  O.ded = [...C.dedication].map((ch, i) => ({ ch, x: 755, y: 430 + i * 50, t: 12.7 + i * 0.13 }));
  O.fadeOut = [15.2, 16.7];          // 题字随风化作花瓣
  // 鸿雁传书：雁阵自右向左飞过月亮，信笺随风而至
  O.geese = [15.0, 22.5];
  O.geeseMoon = lerp(O.geese[0], O.geese[1], (2080 - MOON.x) / 2460);
  O.end = 18.6;
  T.cues.push({ t: O.titleSeal, type: 'seal' });

  // 信
  const L = T.letter = { start: 16.8, cardIn: [16.8, 18.6], pages: [] };
  let cur = O.end;
  C.letterPages.forEach((paras, pi) => {
    const glyphs = layoutVertical(paras, {
      right: CARD.right, top: CARD.top, colPitch: CARD.colPitch, charPitch: CARD.charPitch,
      perCol: CARD.perCol, indent: 2, indentFirst: pi !== 0
    });
    glyphs.forEach(g => { g.alpha = 0.86 + 0.14 * rnd(); });
    const start = cur;
    const tEnd = timeGlyphs(glyphs, start + 0.15, RATE, 0.6);
    const hold = clamp(2.0 + glyphs.length * 0.03, 2.6, 4.8);
    const last = pi === C.letterPages.length - 1;
    const fade = last ? 1.6 : 1.3;
    const end = tEnd + GLYPH_DUR + hold + fade;
    // 小画放在文字左侧的空白处
    const minX = Math.min(...glyphs.map(g => g.x));
    const freeL = CARD.x + 58, freeR = minX - CARD.colPitch / 2 - 16;
    const sc = clamp((freeR - freeL) / ART_W, 0.72, 1.3);
    const art = { name: C.letterArt[pi], s: sc, x: freeL + (freeR - freeL - ART_W * sc) / 2, y: CARD.y + CARD.h - 54 - ART_H * sc, t: start + 0.4 };
    L.pages.push({ start, end, fade, glyphs, art });
    cur = end + 0.2;
  });
  L.end = L.pages[L.pages.length - 1].end;  // 最后一页与信笺一起淡出
  L.cardOut = [L.end - 1.6, L.end];

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
  P.end = P.seal.t + 5.4;
  P.fadeOut = [P.end - 2.0, P.end];

  // 结尾：生日快乐、天灯，最后镜头拉远、卷轴合上
  const E = T.ending = { start: P.end - 0.6 };
  E.small = [...C.endingSmall].map((ch, i) => ({ ch, x: 1075, y: 250 + i * 92, t: E.start + 1.2 + i * 0.5 }));
  E.big = [...C.endingBig].map((ch, i) => ({ ch, x: 880, y: 255 + i * 178, t: E.start + 2.6 + i * 0.75 }));
  E.seal = { x: 745, y: 880, t: E.start + 6.6 };
  E.hbStart = E.start + 1.6;   // 配乐《生日快乐》开始
  E.lanterns = [E.start + 5.5, E.start + 24];
  E.close = [E.start + 26.6, E.start + 28.8, E.start + 31.8];  // 拉远、开始收卷、卷好
  E.end = E.start + 33.8;
  E.fadeOut = [E.end - 2.0, E.end];
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
  const list = { petals: [], gui: [], snow: [], spark: [], scatter: [], lanterns: [] };
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
  const sparkRate = t => 5 * win(t, cp[2].start, cp[3].start, 1.5, 1.5) + 6 * win(t, cp[3].start, E.start + 4, 1.5, 3) + 2 * win(t, E.start + 2, T.duration, 2, 3);
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
  // 字随风化作花瓣
  const scatter = (glyphs, t0, t1) => {
    for (const gl of glyphs) {
      if (gl.isP || rnd() > 0.85) continue;
      const n = rnd() < 0.35 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        list.scatter.push({ t0: t0 + rnd() * (t1 - t0) * 0.7, x: gl.x + (rnd() - 0.5) * 24, y: gl.y + (rnd() - 0.5) * 24,
          vx: -70 - rnd() * 140, vy: -28 + rnd() * 50, amp: 8 + rnd() * 18, f: 0.4 + rnd() * 0.6, ph: rnd() * 6.28,
          spin: (rnd() - 0.5) * 5, flip: 2 + rnd() * 3, r: 5 + rnd() * 3.5, life: 4.5 });
      }
    }
  };
  const O = T.opening;
  scatter([...O.title, ...O.ded], O.fadeOut[0], O.fadeOut[1]);
  for (const pg of T.letter.pages) scatter(pg.glyphs, pg.end - pg.fade, pg.end);
  scatter([...P.glyphs, ...P.sig], P.fadeOut[0], P.fadeOut[1]);
  // 天灯：越远越小、越慢、越淡
  for (let i = 0; i < 26; i++) {
    const depth = rnd();
    list.lanterns.push({ t0: lerp(E.lanterns[0], E.lanterns[1], i / 26) + rnd() * 1.5, x: 120 + rnd() * 1700, depth,
      size: 16 + depth * 30, vy: 18 + depth * 30, amp: 8 + rnd() * 14, f: 0.12 + rnd() * 0.2, ph: rnd() * 6.28 });
  }
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
  for (const p of list.scatter) {
    const a = t - p.t0;
    if (a < 0 || a > p.life) continue;
    const x = p.x + p.vx * a - 12 * a * a + p.amp * Math.sin(p.f * a * 6.28 + p.ph);
    const y = p.y + p.vy * a + 14 * a * a;
    drawPetal(g, x, y, p.r * clamp(a * 3 + 0.3), p.ph + p.spin * a, Math.cos(p.flip * a + p.ph), clamp(a * 4) * clamp((p.life - a) / 1.6) * 0.9);
  }
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

// ---------------------------------------------------------------- 信笺小画
const ART_W = 340, ART_H = 400;

function quadPts(x0, y0, cx, cy, x1, y1, n = 24) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, v = 1 - u;
    out.push([v * v * x0 + 2 * v * u * cx + u * u * x1, v * v * y0 + 2 * v * u * cy + u * u * y1]);
  }
  return out;
}
function taper(g, pts, w0, w1, color, alpha = 1) {
  g.save();
  g.strokeStyle = color; g.lineCap = 'round'; g.globalAlpha = alpha;
  for (let i = 1; i < pts.length; i++) {
    g.lineWidth = lerp(w0, w1, i / (pts.length - 1));
    g.beginPath(); g.moveTo(pts[i - 1][0], pts[i - 1][1]); g.lineTo(pts[i][0], pts[i][1]); g.stroke();
  }
  g.restore();
}
function blob(g, x, y, rx, ry, rgba) {
  g.save(); g.translate(x, y); g.scale(1, ry / rx);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  gr.addColorStop(0, rgba); gr.addColorStop(1, rgba.replace(/[\d.]+\)$/, '0)'));
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rx, 0, 6.2832); g.fill();
  g.restore();
}
function leaf(g, x, y, ang, len, wid, color) {
  g.save(); g.translate(x, y); g.rotate(ang);
  g.fillStyle = color;
  g.beginPath(); g.moveTo(0, 0);
  g.quadraticCurveTo(len * 0.35, -wid, len, 0);
  g.quadraticCurveTo(len * 0.4, wid * 0.75, 0, 0);
  g.fill(); g.restore();
}
function smallLantern(g, x, y, rx, ry, withChar) {
  g.save();
  blob(g, x, y, rx * 2.1, ry * 1.9, 'rgba(255,180,90,0.35)');
  g.strokeStyle = 'rgba(40,30,20,0.8)'; g.lineWidth = 1.2;
  g.fillStyle = 'rgba(70,45,25,0.92)';
  g.fillRect(x - rx * 0.42, y - ry - rx * 0.2, rx * 0.84, rx * 0.24);
  g.fillRect(x - rx * 0.42, y + ry - rx * 0.04, rx * 0.84, rx * 0.24);
  const gr = g.createRadialGradient(x - rx * 0.2, y - ry * 0.25, rx * 0.1, x, y, rx * 1.05);
  gr.addColorStop(0, 'rgba(240,92,60,0.97)'); gr.addColorStop(1, 'rgba(168,22,28,0.97)');
  g.fillStyle = gr;
  g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 6.2832); g.fill();
  g.strokeStyle = 'rgba(110,16,18,0.4)';
  for (const k of [0.35, 0.7]) { g.beginPath(); g.ellipse(x, y, rx * k, ry, 0, 0, 6.2832); g.stroke(); }
  if (withChar) {
    g.fillStyle = 'rgba(252,214,120,0.95)';
    g.font = `${Math.round(rx * 0.95)}px ${FONT.brush}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('福', x, y + rx * 0.04);
  }
  g.strokeStyle = 'rgba(190,36,36,0.9)'; g.lineWidth = 1.4;
  for (let k = -3; k <= 3; k++) {
    g.beginPath(); g.moveTo(x + k * rx * 0.07, y + ry + rx * 0.2); g.lineTo(x + k * rx * 0.1, y + ry + rx * 0.95); g.stroke();
  }
  g.fillStyle = 'rgba(214,168,70,0.95)';
  g.beginPath(); g.arc(x, y + ry + rx * 0.24, rx * 0.09, 0, 6.2832); g.fill();
  g.restore();
}

function makeArt(name) {
  const c = mk(ART_W, ART_H), g = c.getContext('2d');
  const rnd = mulberry32(name.length * 997 + name.charCodeAt(0));
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (name === 'boat') {
    // 孤帆远影：远山、江水、一叶帆、几只归雁
    const hg = g.createLinearGradient(0, 196, 0, 282);
    hg.addColorStop(0, 'rgba(86,96,106,0.32)'); hg.addColorStop(1, 'rgba(86,96,106,0)');
    g.fillStyle = hg; g.beginPath(); g.moveTo(0, 282);
    for (let x = 0; x <= ART_W; x += 6) g.lineTo(x, 252 - 46 * Math.exp(-(((x - 80) / 58) ** 2)) - 30 * Math.exp(-(((x - 250) / 52) ** 2)) + 3 * Math.sin(x * 0.2));
    g.lineTo(ART_W, 282); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(70,95,115,0.42)'; g.lineWidth = 1.6;
    for (let i = 0; i < 7; i++) {
      const y = 300 + i * 14;
      for (let k = 0; k < 3; k++) {
        const x = rnd() * ART_W, l = 20 + rnd() * 60;
        g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + l / 2, y - 2, x + l, y); g.stroke();
      }
    }
    g.fillStyle = 'rgba(70,95,115,0.22)';
    for (let i = 0; i < 4; i++) g.fillRect(132 + rnd() * 30, 312 + i * 9, 18 + rnd() * 24, 1.6);
    g.fillStyle = INK; g.globalAlpha = 0.88;
    g.beginPath(); g.moveTo(94, 296); g.quadraticCurveTo(150, 326, 210, 292); g.quadraticCurveTo(150, 310, 94, 296); g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = INK; g.lineWidth = 2.2; g.beginPath(); g.moveTo(152, 304); g.lineTo(152, 196); g.stroke();
    g.fillStyle = 'rgba(200,158,98,0.78)';
    g.beginPath(); g.moveTo(155, 202); g.quadraticCurveTo(196, 240, 210, 286); g.lineTo(155, 292); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(60,45,30,0.5)'; g.lineWidth = 1;
    for (const y of [222, 246, 270]) { g.beginPath(); g.moveTo(155, y); g.lineTo(155 + (y - 198) * 0.56, y); g.stroke(); }
    g.strokeStyle = INK; g.lineWidth = 1.7;
    for (const [x, y] of [[214, 120], [238, 136], [262, 112], [286, 128], [196, 146]]) {
      g.beginPath(); g.moveTo(x - 8, y - 3); g.quadraticCurveTo(x - 3, y - 5, x, y); g.quadraticCurveTo(x + 3, y - 5, x + 8, y - 3); g.stroke();
    }
  } else if (name === 'home') {
    // 家：柳下小屋，窗里灯火，屋后炊烟
    blob(g, 180, 362, 180, 28, 'rgba(110,125,100,0.22)');
    taper(g, [[54, 372], [52, 300], [62, 232], [58, 168]], 9, 3, INK, 0.85);
    g.strokeStyle = 'rgba(70,104,70,0.6)'; g.lineWidth = 1.3;
    for (let k = 0; k < 14; k++) {
      const x = 46 + rnd() * 34, y = 160 + rnd() * 40, side = rnd() < 0.5 ? -1 : 1;
      g.beginPath(); g.moveTo(x, y);
      g.quadraticCurveTo(x + side * (30 + rnd() * 30), y - 10, x + side * (34 + rnd() * 40), y + 110 + rnd() * 90); g.stroke();
    }
    blob(g, 172, 298, 90, 70, 'rgba(255,190,90,0.45)');
    g.fillStyle = 'rgba(226,210,172,0.92)'; g.fillRect(118, 258, 170, 86);
    g.strokeStyle = 'rgba(40,30,20,0.6)'; g.lineWidth = 1.2; g.strokeRect(118, 258, 170, 86);
    g.fillStyle = 'rgba(252,204,104,0.97)'; g.fillRect(150, 280, 44, 34);
    g.strokeStyle = 'rgba(80,50,30,0.6)'; g.lineWidth = 1;
    g.strokeRect(150, 280, 44, 34);
    g.beginPath(); g.moveTo(172, 280); g.lineTo(172, 314); g.moveTo(150, 297); g.lineTo(194, 297); g.stroke();
    g.fillStyle = 'rgba(110,72,44,0.75)'; g.fillRect(226, 290, 34, 54);
    g.fillStyle = INK; g.globalAlpha = 0.9;
    g.beginPath(); g.moveTo(80, 246); g.quadraticCurveTo(96, 260, 122, 260); g.lineTo(286, 260);
    g.quadraticCurveTo(310, 260, 326, 246); g.lineTo(280, 214); g.lineTo(126, 214); g.closePath(); g.fill();
    g.globalAlpha = 1;
    g.lineWidth = 5; g.strokeStyle = INK;
    g.beginPath(); g.moveTo(116, 206); g.quadraticCurveTo(124, 213, 134, 212); g.lineTo(272, 212); g.quadraticCurveTo(282, 213, 290, 206); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 1.2;
    for (let x = 136; x < 278; x += 9) { g.beginPath(); g.moveTo(x, 216); g.lineTo(x + (x - 203) * 0.25, 258); g.stroke(); }
    g.save(); g.filter = 'blur(3px)';
    const smoke = [[236, 206], [226, 170], [262, 146], [244, 108], [270, 70], [252, 30]];
    g.strokeStyle = 'rgba(120,124,130,0.28)'; g.lineWidth = 12;
    g.beginPath(); g.moveTo(...smoke[0]);
    for (let i = 1; i < smoke.length - 1; i += 2) g.quadraticCurveTo(...smoke[i], ...smoke[i + 1]);
    g.stroke(); g.restore();
    smallLantern(g, 304, 280, 11, 13, false);
  } else if (name === 'bamboo') {
    // 新竹：节节向上
    blob(g, 170, 384, 150, 24, 'rgba(90,100,90,0.25)');
    blob(g, 110, 380, 40, 16, 'rgba(60,64,60,0.4)');
    const stalks = [{ x: 132, top: 46, w: 11, lean: 0.06 }, { x: 186, top: 104, w: 8.5, lean: -0.03 }, { x: 232, top: 168, w: 7, lean: 0.1 }];
    for (const st of stalks) {
      let y = 396, seg = 54;
      while (y > st.top) {
        const y2 = Math.max(st.top, y - seg);
        const x1 = st.x + (396 - y) * st.lean, x2 = st.x + (396 - y2) * st.lean;
        const gr = g.createLinearGradient(x1 - st.w / 2, 0, x1 + st.w / 2, 0);
        gr.addColorStop(0, 'rgba(26,44,34,0.92)'); gr.addColorStop(0.45, 'rgba(62,92,70,0.85)'); gr.addColorStop(1, 'rgba(24,40,30,0.92)');
        g.fillStyle = gr;
        g.beginPath(); g.moveTo(x1 - st.w / 2, y - 2); g.lineTo(x2 - st.w / 2, y2 + 2); g.lineTo(x2 + st.w / 2, y2 + 2); g.lineTo(x1 + st.w / 2, y - 2); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(20,30,24,0.9)'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x2 - st.w * 0.7, y2 + 1); g.quadraticCurveTo(x2, y2 - 2, x2 + st.w * 0.7, y2 + 1); g.stroke();
        if (y2 < 300 && rnd() < 0.8) {
          const side = rnd() < 0.5 ? -1 : 1;
          const tx = x2 + side * (24 + rnd() * 24), ty = y2 - 16 - rnd() * 16;
          g.lineWidth = 1.4; g.beginPath(); g.moveTo(x2, y2); g.lineTo(tx, ty); g.stroke();
          const n = 3 + Math.floor(rnd() * 3);
          for (let k = 0; k < n; k++) {
            const ang = (side > 0 ? 0.25 : Math.PI - 0.25) + (rnd() - 0.5) * 1.3 + 0.35;
            leaf(g, tx, ty, ang, 44 + rnd() * 30, 8 + rnd() * 3, rnd() < 0.3 ? 'rgba(70,100,78,0.65)' : 'rgba(24,40,30,0.88)');
          }
        }
        y = y2; seg *= 0.94;
      }
    }
  } else if (name === 'sea') {
    // 三亚：红日、海水纹、椰林、远帆
    blob(g, 214, 168, 150, 92, 'rgba(250,186,136,0.3)');
    blob(g, 214, 170, 80, 80, 'rgba(240,140,90,0.3)');
    const sg = g.createRadialGradient(206, 160, 4, 214, 170, 36);
    sg.addColorStop(0, 'rgba(236,98,66,0.95)'); sg.addColorStop(1, 'rgba(214,62,46,0.92)');
    g.fillStyle = sg; g.beginPath(); g.arc(214, 170, 36, 0, 6.2832); g.fill();
    const sea = g.createLinearGradient(0, 222, 0, 400);
    sea.addColorStop(0, 'rgba(78,140,150,0.32)'); sea.addColorStop(1, 'rgba(78,140,150,0.1)');
    g.fillStyle = sea; g.fillRect(0, 222, ART_W, 178);
    g.strokeStyle = 'rgba(60,100,110,0.55)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(0, 222); g.lineTo(ART_W, 222); g.stroke();
    g.fillStyle = 'rgba(226,96,62,0.45)';
    for (let i = 0; i < 6; i++) { const w = 46 - i * 6; g.fillRect(214 - w / 2 + (rnd() - 0.5) * 6, 230 + i * 8, w, 2.2); }
    for (const [row, y] of [[0, 262], [1, 292], [2, 324], [3, 358]]) {
      for (let x = -34 + (row % 2) * 17; x < ART_W + 34; x += 34) {
        g.strokeStyle = 'rgba(46,92,108,0.55)'; g.lineWidth = 1.5;
        g.beginPath(); g.arc(x, y, 17, Math.PI, 2 * Math.PI); g.stroke();
        g.strokeStyle = 'rgba(46,92,108,0.32)'; g.lineWidth = 1;
        g.beginPath(); g.arc(x, y, 10, Math.PI, 2 * Math.PI); g.stroke();
      }
    }
    g.fillStyle = INK; g.globalAlpha = 0.8;
    g.beginPath(); g.moveTo(278, 216); g.lineTo(302, 216); g.lineTo(298, 220); g.lineTo(282, 220); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(290, 214); g.lineTo(290, 192); g.lineTo(302, 212); g.closePath(); g.fill();
    g.globalAlpha = 1;
    blob(g, 60, 398, 170, 52, 'rgba(214,184,124,0.65)');
    const trunk = quadPts(56, 400, 54, 286, 116, 150, 30);
    taper(g, trunk, 12, 6, 'rgba(84,62,40,0.95)');
    g.strokeStyle = 'rgba(40,28,18,0.6)'; g.lineWidth = 1.2;
    for (let i = 2; i < trunk.length - 1; i += 2) { const [x, y] = trunk[i]; g.beginPath(); g.moveTo(x - 5, y); g.lineTo(x + 5, y - 2); g.stroke(); }
    const top = [116, 150];
    for (const deg of [-172, -146, -118, -86, -52, -22, 8, 34, 160]) {
      const a = deg * Math.PI / 180, L = 70 + rnd() * 26;
      const ex = top[0] + Math.cos(a) * L, ey = top[1] + Math.sin(a) * L * 0.6 + L * 0.42;
      const cx = top[0] + Math.cos(a) * L * 0.55, cy = top[1] + Math.sin(a) * L * 0.55 - 12;
      const nx = -(ey - top[1]), ny = ex - top[0], nl = Math.hypot(nx, ny) || 1;
      g.fillStyle = 'rgba(34,78,58,0.88)';
      g.beginPath(); g.moveTo(...top);
      g.quadraticCurveTo(cx + nx / nl * 9, cy + ny / nl * 9, ex, ey);
      g.quadraticCurveTo(cx - nx / nl * 4, cy - ny / nl * 4, ...top); g.fill();
      g.strokeStyle = 'rgba(34,78,58,0.7)'; g.lineWidth = 1.1;
      const pts = quadPts(top[0], top[1], cx, cy, ex, ey, 10);
      for (let i = 2; i < pts.length; i++) {
        const [x, y] = pts[i];
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + nx / nl * 9 + 3, y + ny / nl * 9 + 6); g.stroke();
      }
    }
    g.fillStyle = 'rgba(96,66,36,0.95)';
    for (const [x, y] of [[110, 160], [122, 162], [116, 170]]) { g.beginPath(); g.arc(x, y, 5, 0, 6.2832); g.fill(); }
  } else if (name === 'peach') {
    // 寿桃
    taper(g, quadPts(6, 112, 150, 130, 334, 178, 30), 9, 3, INK, 0.9);
    taper(g, quadPts(190, 140, 220, 100, 246, 80, 12), 4, 2, INK, 0.85);
    const lv = [[96, 124, 2.3], [140, 132, 1.0], [176, 140, 2.0], [214, 146, 0.75], [240, 82, -0.6], [262, 158, 1.9], [300, 170, 0.6], [60, 118, 1.5]];
    for (const [x, y, a] of lv) leaf(g, x, y, a, 58 + rnd() * 18, 13, rnd() < 0.5 ? 'rgba(66,108,66,0.85)' : 'rgba(40,64,44,0.88)');
    const peach = (x, y, r) => {
      g.save();
      const gr = g.createRadialGradient(x + r * 0.25, y - r * 0.45, r * 0.08, x, y, r * 1.15);
      gr.addColorStop(0, 'rgba(234,86,92,0.96)'); gr.addColorStop(0.55, 'rgba(244,168,138,0.94)'); gr.addColorStop(1, 'rgba(226,212,148,0.94)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(x + r * 0.08, y - r * 1.08);
      g.bezierCurveTo(x + r * 1.15, y - r * 0.9, x + r * 1.05, y + r * 0.92, x, y + r);
      g.bezierCurveTo(x - r * 1.05, y + r * 0.92, x - r * 1.12, y - r * 0.72, x + r * 0.08, y - r * 1.08);
      g.fill();
      g.strokeStyle = 'rgba(190,70,70,0.5)'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(x + r * 0.08, y - r * 1.02); g.quadraticCurveTo(x - r * 0.3, y - r * 0.2, x - r * 0.1, y + r * 0.5); g.stroke();
      g.restore();
    };
    peach(128, 236, 50); peach(214, 256, 44); leaf(g, 170, 286, 2.6, 50, 12, 'rgba(50,84,52,0.85)'); peach(168, 316, 42);
  } else if (name === 'lantern') {
    // 灯笼：生日的喜气
    taper(g, quadPts(0, 44, 170, 30, 340, 62, 30), 6, 3, INK, 0.9);
    for (const [x, y] of [[240, 54], [70, 40], [300, 60]]) drawBlossom(g, { x, y, r: 15, type: 'full', rot: x, tilt: 0.4, squash: 0.85, seed: x }, 1);
    g.strokeStyle = 'rgba(40,30,20,0.8)'; g.lineWidth = 1.3;
    g.beginPath(); g.moveTo(110, 40); g.lineTo(110, 120); g.moveTo(242, 52); g.lineTo(242, 166); g.stroke();
    smallLantern(g, 110, 182, 52, 60, true);
    smallLantern(g, 242, 226, 44, 52, true);
  }
  // 四边羽化，像画在笺上而不是贴上去的
  g.globalCompositeOperation = 'destination-in';
  const fx = g.createLinearGradient(0, 0, ART_W, 0);
  fx.addColorStop(0, 'rgba(0,0,0,0)'); fx.addColorStop(0.1, 'rgba(0,0,0,1)'); fx.addColorStop(0.9, 'rgba(0,0,0,1)'); fx.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fx; g.fillRect(0, 0, ART_W, ART_H);
  const fy = g.createLinearGradient(0, 0, 0, ART_H);
  fy.addColorStop(0, 'rgba(0,0,0,0)'); fy.addColorStop(0.08, 'rgba(0,0,0,1)'); fy.addColorStop(0.95, 'rgba(0,0,0,1)'); fy.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fy; g.fillRect(0, 0, ART_W, ART_H);
  return c;
}

const abuf = mk(ART_W, ART_H), ab = abuf.getContext('2d');
// 小画如墨在纸上化开：从画心向外显现
function inkReveal(g, img, x, y, s, p, alpha) {
  if (p <= 0 || alpha <= 0) return;
  g.save();
  g.globalAlpha *= alpha;
  g.globalCompositeOperation = 'multiply';
  if (p >= 1) { g.drawImage(img, x, y, ART_W * s, ART_H * s); g.restore(); return; }
  ab.setTransform(1, 0, 0, 1, 0, 0);
  ab.globalCompositeOperation = 'source-over';
  ab.clearRect(0, 0, ART_W, ART_H);
  ab.drawImage(img, 0, 0);
  const R = Math.hypot(ART_W, ART_H) * 0.62, r = p * R * 1.3;
  const gr = ab.createRadialGradient(ART_W * 0.5, ART_H * 0.62, Math.max(0, r - R * 0.4), ART_W * 0.5, ART_H * 0.62, r + 1);
  gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  ab.globalCompositeOperation = 'destination-in';
  ab.fillStyle = gr; ab.fillRect(0, 0, ART_W, ART_H);
  g.drawImage(abuf, x, y, ART_W * s, ART_H * s);
  g.restore();
}

// ---------------------------------------------------------------- 雁阵
const GEESE = [[0, 0], [44, -17], [44, 19], [88, -33], [88, 37], [132, -48], [132, 55]];
function wing(g, f, off) {
  const tipY = -21 * f, tipX = 6 + 4 * Math.abs(f);
  g.beginPath(); g.moveTo(-4, -1 + off);
  g.quadraticCurveTo(-2, tipY * 0.55 - 2 + off, tipX, tipY + off);
  g.quadraticCurveTo(5, tipY * 0.3 + off, 8, off);
  g.closePath(); g.fill();
}
function drawGoose(g, x, y, s, ph) {
  const f = Math.sin(ph);
  g.save(); g.translate(x, y); g.scale(s, s);
  g.fillStyle = INK; g.strokeStyle = INK; g.lineCap = 'round';
  g.globalAlpha = 0.45; wing(g, f * 0.75, -1.5);
  g.globalAlpha = 0.85;
  g.beginPath(); g.ellipse(2, 0, 11.5, 3.5, -0.04, 0, 6.2832); g.fill();
  g.lineWidth = 2.3;
  g.beginPath(); g.moveTo(-7, -0.6); g.quadraticCurveTo(-13, -2.2, -19, -2.6); g.stroke();
  g.beginPath(); g.arc(-20, -2.7, 2.4, 0, 6.2832); g.fill();
  g.lineWidth = 1.3; g.beginPath(); g.moveTo(-22, -2.5); g.lineTo(-26.5, -1.7); g.stroke();
  g.beginPath(); g.moveTo(12, -1.2); g.lineTo(17.5, 0); g.lineTo(12, 2); g.fill();
  wing(g, f, 0);
  g.restore();
}
function drawGeese(g, t) {
  const [g0, g1] = T.opening.geese;
  if (t < g0 || t > g1) return;
  const u = (t - g0) / (g1 - g0);
  const cx = lerp(2080, -380, u), cy = 262 - 74 * u;
  GEESE.forEach(([dx, dy], i) => {
    drawGoose(g, cx + dx + 6 * Math.sin(t * 0.9 + i * 1.7), cy + dy + 4 * Math.sin(t * 1.3 + i), 1.05 - i * 0.035, t * 6.2832 * 1.5 + i * 0.9);
  });
}

// ---------------------------------------------------------------- 天灯
function drawLanterns(g, list, t) {
  for (const L of list) {
    const a = t - L.t0;
    if (a < 0) continue;
    const y = H + 60 - L.vy * a;
    if (y < -80) continue;
    const x = L.x + L.amp * Math.sin(L.f * a * 6.2832 + L.ph);
    const s = L.size, fl = 0.5 + 0.5 * Math.sin(t * 9 + L.ph * 5) * Math.sin(t * 5.3 + L.ph);
    g.save();
    g.translate(x, y);
    g.globalAlpha = clamp(a / 1.5) * (0.55 + 0.45 * L.depth);
    blob(g, 0, s * 0.15, s * 2.6, s * 2.6, `rgba(255,186,92,${(0.3 + 0.1 * fl).toFixed(3)})`);
    const gr = g.createLinearGradient(0, -s * 0.66, 0, s * 0.62);
    gr.addColorStop(0, 'rgba(210,88,46,0.96)');
    gr.addColorStop(0.65, `rgba(248,${170 + Math.round(30 * fl)},92,0.97)`);
    gr.addColorStop(1, 'rgba(255,228,150,1)');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(-s * 0.46, -s * 0.62); g.quadraticCurveTo(0, -s * 0.8, s * 0.46, -s * 0.62);
    g.lineTo(s * 0.36, s * 0.58); g.quadraticCurveTo(0, s * 0.66, -s * 0.36, s * 0.58); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(150,50,26,0.3)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(-s * 0.15, -s * 0.7); g.lineTo(-s * 0.12, s * 0.62); g.moveTo(s * 0.15, -s * 0.7); g.lineTo(s * 0.12, s * 0.62); g.stroke();
    g.fillStyle = `rgba(255,246,196,${(0.75 + 0.25 * fl).toFixed(3)})`;
    g.beginPath(); g.ellipse(0, s * 0.5, s * 0.13, s * 0.08, 0, 0, 6.2832); g.fill();
    g.restore();
  }
}

// ---------------------------------------------------------------- 卷轴
const SCROLL_S0 = 0.84;   // 卷轴全景时画心的缩放
function makeTable() {
  const c = mk(W, H), g = c.getContext('2d');
  const gr = g.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, W * 0.7);
  gr.addColorStop(0, '#3a2b22'); gr.addColorStop(1, '#120c09');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const r = mulberry32(17), n = noise1(23);
  for (let y = 0; y < H; y += 3) {
    const a = 0.025 + 0.03 * fbm(n, y * 0.01, 3);
    g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(120,80,50,${a * 0.6})`;
    g.fillRect(0, y + Math.sin(y * 0.05) * 1.5, W, 1 + r() * 2);
  }
  return c;
}
function drawRoller(g, x, y, w, h, s) {
  const gr = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  gr.addColorStop(0, '#2c100c'); gr.addColorStop(0.35, '#86372a'); gr.addColorStop(0.55, '#a44e38'); gr.addColorStop(1, '#250d0a');
  g.fillStyle = gr; g.fillRect(x - w / 2, y, w, h);
  g.fillStyle = 'rgba(222,178,96,0.55)';
  for (let yy = y + 14 * s; yy < y + h - 8 * s; yy += 26 * s) {
    g.beginPath(); g.moveTo(x, yy - 5 * s); g.lineTo(x + w * 0.2, yy); g.lineTo(x, yy + 5 * s); g.lineTo(x - w * 0.2, yy); g.closePath(); g.fill();
  }
  const kh = 30 * s, kw = w * 0.8;
  for (const ky of [y - kh, y + h]) {
    const kg = g.createLinearGradient(x - kw / 2, 0, x + kw / 2, 0);
    kg.addColorStop(0, '#8f8774'); kg.addColorStop(0.4, '#f0ebdc'); kg.addColorStop(1, '#7f7764');
    g.fillStyle = kg; g.beginPath(); g.roundRect(x - kw / 2, ky, kw, kh, 6 * s); g.fill();
  }
}
function scrollState(t) {
  const O = T.opening, E = T.ending;
  if (t < E.close[0]) return { u: easeInOut(ramp(t, O.unroll[0], O.unroll[1])), s: lerp(SCROLL_S0, 1, easeInOut(ramp(t, O.push[0], O.push[1]))) };
  return { u: 1 - easeInOut(ramp(t, E.close[1], E.close[2])), s: lerp(1, SCROLL_S0, easeInOut(ramp(t, E.close[0], E.close[1]))) };
}
function drawScroll(g, scene, t) {
  const { u, s } = scrollState(t);
  if (u >= 1 && s >= 1) { g.drawImage(scene, 0, 0); return; }
  g.drawImage(table, 0, 0);
  const pw = W * s, ph = H * s, cx = W / 2, cy = H / 2;
  const strip = 26 * s, rw = 40 * s, half = (pw / 2) * u;
  const top = cy - ph / 2, bot = cy + ph / 2;
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 50 * s; g.shadowOffsetY = 18 * s;
  g.fillStyle = '#cdc2a6'; g.fillRect(cx - half - rw / 2, top - strip, 2 * half + rw, ph + 2 * strip);
  g.restore();
  if (half > 0.5) {
    g.fillStyle = '#cdc2a6';
    g.fillRect(cx - half, top - strip, 2 * half, strip); g.fillRect(cx - half, bot, 2 * half, strip);
    g.strokeStyle = 'rgba(140,118,80,0.45)'; g.lineWidth = 1;
    for (const y of [top - strip + 5 * s, bot + strip - 5 * s]) { g.beginPath(); g.moveTo(cx - half, y); g.lineTo(cx + half, y); g.stroke(); }
    g.save(); g.beginPath(); g.rect(cx - half, top, 2 * half, ph); g.clip();
    g.drawImage(scene, cx - pw / 2, top, pw, ph);
    g.restore();
    g.strokeStyle = 'rgba(90,70,40,0.6)'; g.lineWidth = 1.2 * s; g.strokeRect(cx - half, top, 2 * half, ph);
  }
  drawRoller(g, cx - half - rw / 2, top - strip, rw, ph + 2 * strip, s);
  drawRoller(g, cx + half + rw / 2, top - strip, rw, ph + 2 * strip, s);
}

// 字被风吹走：左移、上扬、虚化、变淡
function blow(g, u) {
  if (u <= 0) return;
  g.globalAlpha *= 1 - smooth(u);
  g.translate(-80 * u * u, -16 * u);
  if (u > 0.04) g.filter = `blur(${(u * 3.5).toFixed(2)}px)`;
}

// ---------------------------------------------------------------- 主渲染
let T, tree, paper, mountains, card, parts, branchCache, branchLayer, seals, arts, table, scene, sctx;

function render(t) {
  // 先在 scene 上画整幅画，再由卷轴/镜头合成到屏幕
  const g = sctx;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
  g.drawImage(paper, 0, 0);

  const O = T.opening, L = T.letter, P = T.poem, E = T.ending;
  const cp = P.couplets;

  // 远山，缓缓平移
  g.drawImage(mountains, -80 - 50 * (t / T.duration), 0);

  // 冷色淡墨（雪）与暖光
  const coolK = win(t, cp[1].start, cp[2].start + 0.5, 1.5, 2);
  if (coolK > 0) { g.fillStyle = `rgba(70,84,100,${0.13 * coolK})`; g.fillRect(0, 0, W, H); }
  const lightK = win(t, cp[2].start, cp[3].start + 1, 1.8, 2.5);
  const endGlow = 0.6 * win(t, E.start + 1, T.duration, 3, 4);
  drawMoon(g, 1, Math.max(lightK, endGlow, 0.25 * win(t, cp[3].start, P.end, 2, 2)));
  drawRays(g, lightK, t);
  drawLanterns(g, parts.lanterns, t);

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
  if (t > O.title[0].t && t < O.fadeOut[1]) {
    const u = ramp(t, O.fadeOut[0], O.fadeOut[1]);
    g.save(); blow(g, u);
    drawGlyphs(g, O.title, t, FONT.brush, 112, 1.1, INK, 4);
    drawGlyphs(g, O.ded, t, FONT.kai, 38, 0.7, '#4a3f35', 2);
    g.restore();
    g.save(); g.globalAlpha = 1 - smooth(u);
    drawSeal(g, seals.name, 880, 300 + 5 * 126 + 30, ramp(t, O.titleSeal, O.titleSeal + 0.45), 0.8);
    g.restore();
  }

  // 诗
  if (t > P.start && t < P.fadeOut[1]) {
    const u = ramp(t, P.fadeOut[0], P.fadeOut[1]);
    g.save(); blow(g, u);
    drawGlyphs(g, P.glyphs, t, FONT.brush, P.layout.size, POEM_GLYPH_DUR, INK, 4);
    drawGlyphs(g, P.sig, t, FONT.brush, 40, 0.6, '#2e2823', 2);
    g.restore();
    g.save(); g.globalAlpha = 1 - smooth(u);
    drawSeal(g, seals.name, P.seal.x, P.seal.y, ramp(t, P.seal.t, P.seal.t + 0.45), 0.62);
    g.restore();
  }

  // 结尾
  if (t > E.start) {
    drawGlyphs(g, E.small, t, FONT.xing, 76, 0.9, '#2b2520', 3);
    drawGlyphs(g, E.big, t, FONT.brush, 158, 1.3, INK, 5);
    drawSeal(g, seals.name, E.seal.x, E.seal.y, ramp(t, E.seal.t, E.seal.t + 0.45), 0.8);
  }

  // 雁阵在信笺之后（更远）
  drawGeese(g, t);

  // 信笺：随雁阵从右侧飘来
  if (t > L.cardIn[0] && t < L.end) {
    const e = easeOut(ramp(t, L.cardIn[0], L.cardIn[1]));
    const out = smooth(ramp(t, L.cardOut[0], L.cardOut[1]));
    const ccx = CARD.x + CARD.w / 2, ccy = CARD.y + CARD.h / 2;
    g.save();
    g.globalAlpha = smooth(ramp(t, L.cardIn[0], L.cardIn[0] + 0.7)) * (1 - out);
    g.translate(ccx + 1150 * (1 - e), ccy - 90 * (1 - e) - 24 * out);
    g.rotate(0.13 * (1 - e) * (1 - e));
    g.translate(-ccx, -ccy);
    g.drawImage(card.img, CARD.x - card.pad, CARD.y - card.pad);
    for (const pg of L.pages) {
      if (t < pg.start || t > pg.end) continue;
      const u = ramp(t, pg.end - pg.fade, pg.end);
      const art = pg.art;
      inkReveal(g, arts[art.name], art.x, art.y, art.s, ramp(t, art.t, art.t + 2.4), 1 - smooth(u));
      g.save(); blow(g, u);
      drawGlyphs(g, pg.glyphs, t, FONT.kai, CARD.size, GLYPH_DUR, INK, 2.5);
      g.restore();
    }
    g.restore();
  }

  drawParticles(g, parts, t);

  // 合成到屏幕
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  drawScroll(ctx, scene, t);
  const fade = Math.max(1 - smooth(ramp(t, 0, 1.0)), smooth(ramp(t, E.fadeOut[0], E.fadeOut[1])));
  if (fade > 0) { ctx.globalAlpha = fade; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
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
  arts = Object.fromEntries(C.letterArt.map(n => [n, makeArt(n)]));
  table = makeTable();
  scene = mk(W, H); sctx = scene.getContext('2d');
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
    opening: {
      start: 0, end: T.opening.end, unroll: T.opening.unroll, growStart: T.opening.growStart,
      titleTimes: T.opening.title.map(g => g.t), titleSeal: T.opening.titleSeal, dedStart: T.opening.ded[0].t,
      fadeOut: T.opening.fadeOut, geeseMoon: T.opening.geeseMoon,
    },
    letter: { start: T.letter.start, end: T.letter.end, pages: T.letter.pages.map(p => ({ start: p.start, end: p.end })) },
    poem: { start: T.poem.start, end: T.poem.end, couplets: T.poem.couplets.map(c => c.start), seal: T.poem.seal.t },
    ending: { start: T.ending.start, hbStart: T.ending.hbStart, seal: T.ending.seal.t, close: T.ending.close, end: T.ending.end },
    cues: T.cues,
  }),
};
})();
