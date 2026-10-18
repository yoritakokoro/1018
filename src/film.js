// 《梅香寄北堂》—— 画面引擎
// 所有画面都是时间 t（秒）的纯函数：FILM.render(t) 画出第 t 秒的一帧，
// 因此既可以在浏览器里实时播放，也可以逐帧离线渲染成视频。
// 画面素材在 src/assets/（由 tools/prep_assets.py 生成）。
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

function noise2(seed) {
  const r = mulberry32(seed), N = 256, v = new Float32Array(N * N);
  for (let i = 0; i < v.length; i++) v[i] = r();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const i0 = (yi & 255) * N, i1 = ((yi + 1) & 255) * N, x0 = xi & 255, x1 = (xi + 1) & 255;
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    const a = v[i0 + x0], b = v[i0 + x1], c = v[i1 + x0], d = v[i1 + x1];
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
}
function fbm2(n, x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1, tot = 0;
  for (let i = 0; i < oct; i++) { s += a * n(x * f + i * 17.3, y * f - i * 9.1); tot += a; a *= 0.5; f *= 2; }
  return s / tot;
}

// ---------------------------------------------------------------- 素材
const ASSETS = [
  'paper', 'home', 'spring', 'summer', 'autumn', 'winter', 'wash_pink', 'wash_warm', 'card',
  'panel1', 'panel2', 'panel3', 'panel4', 'panel5', 'panel6',
  'scroll', 'plum', 'mountains', 'moon', 'envelope', 'osmanthus', 'books', 'window', 'swirl', 'clouds',
  'inkcloud1', 'inkcloud2', 'knot', 'jade', 'plumseal', 'corner_tl', 'corner_br', 'orbs',
  ...[0, 1, 2, 3, 4, 5, 6].map(i => 'goose' + i),
  ...[0, 1, 2, 3, 4].map(i => 'flake' + i),
  ...[0, 1, 2, 3, 4].map(i => 'maple' + i),
];
const IMG = {};
function loadImages() {
  return Promise.all(ASSETS.map(name => new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => { IMG[name] = im; resolve(); };
    im.onerror = () => reject(new Error('缺少素材 assets/' + name + '.webp'));
    im.src = `assets/${name}.webp`;
  })));
}
// 读像素（用 file:// 打开时浏览器不允许，返回 null）
function pixels(img, w, h) {
  try {
    const c = mk(w, h), g = c.getContext('2d');
    g.drawImage(img, 0, 0, w, h);
    return g.getImageData(0, 0, w, h).data;
  } catch (e) { return null; }
}

// 墨迹晕开：每个像素有一个“显现时刻” D∈[0,1]，进度 u 越过它时该像素显出
class Reveal {
  constructor(w, h, dfn, res = 0.5) {
    this.mw = Math.max(1, Math.round(w * res)); this.mh = Math.max(1, Math.round(h * res));
    this.D = new Float32Array(this.mw * this.mh);
    for (let y = 0, i = 0; y < this.mh; y++) for (let x = 0; x < this.mw; x++, i++) this.D[i] = dfn(x / this.mw, y / this.mh, i);
    this.mask = mk(this.mw, this.mh); this.mctx = this.mask.getContext('2d');
    this.id = this.mctx.createImageData(this.mw, this.mh);
    this.buf = mk(w, h); this.bctx = this.buf.getContext('2d');
  }
  draw(g, src, u, x, y, dw, dh, soft = 0.12) {
    if (u <= 0) return;
    if (u >= 1) { g.drawImage(src, x, y, dw, dh); return; }
    const d = this.id.data, D = this.D, th = u * (1 + soft);
    for (let i = 0; i < D.length; i++) {
      const v = (th - D[i]) / soft;
      d[i * 4 + 3] = v <= 0 ? 0 : v >= 1 ? 255 : v * 255;
    }
    this.mctx.putImageData(this.id, 0, 0);
    const b = this.bctx;
    b.globalCompositeOperation = 'copy';
    b.drawImage(src, 0, 0, this.buf.width, this.buf.height);
    b.globalCompositeOperation = 'destination-in';
    b.drawImage(this.mask, 0, 0, this.buf.width, this.buf.height);
    b.globalCompositeOperation = 'source-over';
    g.drawImage(this.buf, x, y, dw, dh);
  }
}

// 以 (x,y) 为左上角、缩放 s 画一张图；flip 为水平翻转
function put(g, img, x, y, s = 1, flip = false) {
  if (!flip) { g.drawImage(img, x, y, img.width * s, img.height * s); return; }
  g.save(); g.translate(x + img.width * s, y); g.scale(-1, 1);
  g.drawImage(img, 0, 0, img.width * s, img.height * s);
  g.restore();
}
function blob(g, x, y, rx, ry, rgba) {
  g.save(); g.translate(x, y); g.scale(1, ry / rx);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  gr.addColorStop(0, rgba); gr.addColorStop(1, rgba.replace(/[\d.]+\)$/, '0)'));
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rx, 0, 6.2832); g.fill();
  g.restore();
}

// ---------------------------------------------------------------- 构图
const MOON = { x: 96, y: 70, s: 0.62 };          // 月（左上）
const MOUNT = { x: -150, y: 610, s: 0.8 };        // 远山（左下）
const PLUM = { x: 808, y: -40, s: 0.8 };          // 梅枝（右上，翻转后由右上角伸出）
const PANEL = { x: 210, y: 90, w: 506, h: 900 };  // 信旁竖幅画
const CARD = { x: 786, y: 80, w: 924, h: 920, cols: 8, colPitch: 98, perCol: 12, charPitch: 62, size: 50 };
CARD.top = CARD.y + (CARD.h - CARD.perCol * CARD.charPitch) / 2 + CARD.charPitch / 2;
CARD.right = CARD.x + CARD.w - 70 - CARD.colPitch / 2;
// 卷轴素材：纸面、内芯、两端轴头在原图中的位置
const SCROLL = { cx: 837.5, half: 642, paper: [195, 1480], inner: { x: 205, y: 212, w: 1265, h: 526 },
  rollL: [20, 203], rollR: [1468, 1660], fit: 1.017 };
SCROLL.zFull = W / (SCROLL.fit * SCROLL.inner.w);  // 推到这个倍数时，卷中画与全屏画一样大
const TITLE = { x: 690, y: 290 };   // 题字首字位置
const END = { x: 615, y: 250 };     // 结尾“生日快乐”首字位置

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
const GEESE_SPAN = [-760, 2000];  // 雁阵左端的起止 x

function buildTimeline() {
  const T = { cues: [] };
  const rnd = mulberry32(99);

  // 开场：案上卷轴展开 → 推近入画 → 梅枝生长 → 题字
  const O = T.opening = { start: 0, unroll: [1.0, 4.2], push: [3.9, 6.2], growStart: 5.2, growEnd: 11.0 };
  O.title = [...C.title].map((ch, i) => ({ ch, x: TITLE.x, y: TITLE.y + i * 126, t: 8.6 + i * 0.55 }));
  O.titleSeal = 12.1;
  O.ded = [...C.dedication].map((ch, i) => ({ ch, x: TITLE.x - 125, y: TITLE.y + 130 + i * 50, t: 12.7 + i * 0.13 }));
  O.fadeOut = [15.2, 16.7];          // 题字随风化作花瓣
  // 鸿雁传书：雁阵飞过月亮；一阵花雨送来信封，镜头推向信笺
  O.geese = [14.6, 21.6];
  const moonX = MOON.x + 332 * MOON.s;
  O.geeseMoon = lerp(O.geese[0], O.geese[1], (moonX - 370 - GEESE_SPAN[0]) / (GEESE_SPAN[1] - GEESE_SPAN[0]));
  O.swirl = [16.2, 19.6];
  O.envIn = [17.2, 18.6];
  O.envZoom = [19.8, 21.3];
  O.end = 21.4;
  T.cues.push({ t: O.titleSeal, type: 'seal' });

  // 信
  const L = T.letter = { start: 20.5, cardIn: [20.5, 21.4], pages: [] };
  L.seal = 21.6;  // 信笺右上角的引首章
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
    const fade = pi === C.letterPages.length - 1 ? 1.6 : 1.3;
    const end = tEnd + GLYPH_DUR + hold + fade;
    L.pages.push({ start, end, fade, glyphs, panel: IMG['panel' + (pi + 1)] });
    cur = end + 0.2;
  });
  L.end = L.pages[L.pages.length - 1].end;

  // 诗：每联换一幅景
  const P = T.poem = { start: L.end - 0.3, couplets: [] };
  const PO = { right: 1410, top: 250, colPitch: 100, gap: 30, charPitch: 92, size: 78 };
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
  const cp = P.couplets;
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
  // 背景：金风送桂（秋）→ 映雪红英（冬）→ 书窗（暖纸）→ 四时皆胜景（春夏秋冬轮转）→ 回到梅花图
  const c4 = cp[3].start;
  P.bgs = [
    { img: 'autumn', t: P.start - 1.2, dur: 1.7 },
    { img: 'winter', t: cp[1].start - 0.5, dur: 1.4 },
    { img: 'wash_warm', t: cp[2].start - 0.5, dur: 1.4 },
    { img: 'spring', t: c4 - 0.3, dur: 1.0 },
    { img: 'summer', t: c4 + 1.3, dur: 1.0 },
    { img: 'autumn', t: c4 + 2.8, dur: 1.0 },
    { img: 'winter', t: c4 + 4.3, dur: 1.0 },
    { img: 'home', t: c4 + 5.8, dur: 1.5 },
  ];
  P.osm = [cp[0].start - 0.4, cp[1].start + 0.4];
  P.swirl = [cp[1].start + 2.2, cp[1].start + 6.4];
  P.study = [cp[2].start - 0.3, c4 + 0.2];
  P.hang = c4 + 5.6;  // 如意挂饰垂下

  // 结尾：生日快乐、天灯，最后镜头拉远、卷轴合上
  const E = T.ending = { start: P.end - 0.6 };
  E.small = [...C.endingSmall].map((ch, i) => ({ ch, x: END.x + 162, y: END.y - 5 + i * 92, t: E.start + 1.2 + i * 0.5 }));
  E.big = [...C.endingBig].map((ch, i) => ({ ch, x: END.x, y: END.y + i * 178, t: E.start + 2.6 + i * 0.75 }));
  E.seal = { x: END.x - 135, y: END.y + 625, t: E.start + 6.6 };
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

// ---------------------------------------------------------------- 梅花图（开场与结尾的主画面）
let plumReveal, petalSources;
function setupPlum() {
  const img = IMG.plum, rw = Math.round(img.width / 2), rh = Math.round(img.height / 2);
  const px = pixels(img, rw, rh), n = noise2(41);
  // 显现时刻：离枝根（原图左上角）越远越晚；花比枝晚一点，像是枝先写到、花再开
  plumReveal = new Reveal(img.width, img.height, (x, y, i) => {
    let d = Math.hypot(x, y * 0.85) / 1.2 + (fbm2(n, x * 7, y * 7, 3) - 0.5) * 0.14;
    if (px && px[i * 4] > px[i * 4 + 1] + 60 && px[i * 4 + 3] > 80) d += 0.07;
    return clamp(d);
  });
  // 落花从花多的地方飘下
  petalSources = [];
  const r = mulberry32(5);
  for (let k = 0; k < 4000 && petalSources.length < 80; k++) {
    const x = Math.floor(r() * rw), y = Math.floor(r() * rh), i = (y * rw + x) * 4;
    if (!px || (px[i] > px[i + 1] + 70 && px[i + 3] > 150)) {
      petalSources.push({ x: PLUM.x + (img.width - x * 2) * PLUM.s, y: PLUM.y + y * 2 * PLUM.s });
    }
  }
}

function drawHome(g, t, grow) {
  g.drawImage(IMG.paper, 0, 0);
  put(g, IMG.mountains, MOUNT.x - 30 * (t / T.duration), MOUNT.y, MOUNT.s);
  const glow = 0.5 + 0.5 * Math.sin(t * 0.8);
  blob(g, MOON.x + 332 * MOON.s, MOON.y + 221 * MOON.s, 260, 260, `rgba(255,200,140,${(0.16 + 0.05 * glow).toFixed(3)})`);
  put(g, IMG.moon, MOON.x, MOON.y, MOON.s);
  const img = IMG.plum;
  g.save();
  g.translate(PLUM.x + img.width * PLUM.s, PLUM.y); g.scale(-1, 1);
  plumReveal.draw(g, img, grow, 0, 0, img.width * PLUM.s, img.height * PLUM.s);
  g.restore();
}

// ---------------------------------------------------------------- 卷轴
let table, sceneBuf, sbctx, feather;
function makeTable() {
  const c = mk(W, H), g = c.getContext('2d');
  const gr = g.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, W * 0.7);
  gr.addColorStop(0, '#3a2b22'); gr.addColorStop(1, '#120c09');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const r = mulberry32(17), n = noise2(23);
  for (let y = 0; y < H; y += 3) {
    const a = 0.025 + 0.03 * fbm2(n, y * 0.01, 0.5, 3);
    g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(120,80,50,${a * 0.6})`;
    g.fillRect(0, y + Math.sin(y * 0.05) * 1.5, W, 1 + r() * 2);
  }
  return c;
}
function makeFeather(w, h, edge) {
  const c = mk(w, h), g = c.getContext('2d');
  g.filter = `blur(${edge / 2}px)`;
  g.fillStyle = '#fff'; g.fillRect(edge, edge, w - edge * 2, h - edge * 2);
  return c;
}
function scrollState(t) {
  const O = T.opening, E = T.ending;
  if (t < E.close[0]) return { u: easeInOut(ramp(t, O.unroll[0], O.unroll[1])), z: lerp(1, SCROLL.zFull, easeInOut(ramp(t, O.push[0], O.push[1]))) };
  return { u: 1 - easeInOut(ramp(t, E.close[1], E.close[2])), z: lerp(SCROLL.zFull, 1, easeInOut(ramp(t, E.close[0], E.close[1]))) };
}
// 画心随卷轴展开；scene 是同一时刻的全屏画面
function drawScrollView(g, t, scene) {
  const { u, z } = scrollState(t);
  const img = IMG.scroll, k = SCROLL.fit * z, half = u * SCROLL.half, I = SCROLL.inner;
  g.drawImage(table, 0, 0);
  g.save();
  g.translate(W / 2, H / 2); g.scale(k, k); g.translate(-SCROLL.cx, -img.height / 2);
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 40 * k; g.shadowOffsetY = 16 * k;
  g.fillStyle = '#2a1d15';
  g.fillRect(SCROLL.cx - half - 150, 110, half * 2 + 300, 720);
  g.restore();
  if (half > 1) {
    g.save();
    g.beginPath(); g.rect(SCROLL.cx - half, 0, half * 2, img.height); g.clip();
    const [p0, p1] = SCROLL.paper;
    g.drawImage(img, p0, 0, p1 - p0, img.height, p0, 0, p1 - p0, img.height);
    const sh = W * I.h / I.w;
    sbctx.globalCompositeOperation = 'copy';
    sbctx.drawImage(scene, 0, (H - sh) / 2, W, sh, 0, 0, I.w, I.h);
    sbctx.globalCompositeOperation = 'destination-in';
    sbctx.drawImage(feather, 0, 0);
    sbctx.globalCompositeOperation = 'source-over';
    g.drawImage(sceneBuf, I.x, I.y);
    g.restore();
  }
  const [l0, l1] = SCROLL.rollL, [r0, r1] = SCROLL.rollR;
  g.drawImage(img, l0, 0, l1 - l0, img.height, SCROLL.cx - half + 8 - (l1 - l0), 0, l1 - l0, img.height);
  g.drawImage(img, r0, 0, r1 - r0, img.height, SCROLL.cx + half - 12, 0, r1 - r0, img.height);
  g.restore();
}

// ---------------------------------------------------------------- 雁阵、花雨、信封
const GOOSE_POS = [[52, 463], [200, 427], [431, 336], [661, 508], [803, 629], [1001, 535], [1188, 682]];
function drawGeese(g, t) {
  const [g0, g1] = T.opening.geese;
  if (t < g0 || t > g1) return;
  const u = (t - g0) / (g1 - g0), fs = 0.5;
  const ox = lerp(GEESE_SPAN[0], GEESE_SPAN[1], u), oy = lerp(-30, -110, u);
  GOOSE_POS.forEach(([bx, by], i) => {
    const img = IMG['goose' + i], s = fs / 0.8, w = img.width * s, h = img.height * s;
    const x = ox + (bx - 6) * fs + w / 2, y = oy + (by - 6) * fs + h / 2 + 5 * Math.sin(t * 2.1 + i * 1.3);
    g.save();
    g.translate(x, y); g.rotate(0.035 * Math.sin(t * 1.6 + i)); g.scale(1, 1 + 0.06 * Math.sin(t * 6.5 + i * 0.9));
    g.drawImage(img, -w / 2, -h / 2, w, h);
    g.restore();
  });
}
function drawSwirl(g, t, [a, b], y, alpha = 0.9) {
  if (t < a || t > b) return;
  const u = (t - a) / (b - a), img = IMG.swirl;
  g.save();
  g.globalAlpha *= alpha * win(t, a, b, 0.8, 1.2);
  g.drawImage(img, lerp(-img.width, W + 200, easeInOut(u)), y - img.height / 2);
  g.restore();
}
const LETTER_IN_ENVELOPE = [1021, 463];  // 信笺在信封图中的中心
function drawEnvelope(g, t) {
  const O = T.opening, img = IMG.envelope;
  if (t < O.envIn[0]) return;
  const e = easeOut(ramp(t, O.envIn[0], O.envIn[1])), z = easeInOut(ramp(t, O.envZoom[0], O.envZoom[1]));
  const s = lerp(0.72, 1.6, z);
  const ax = lerp(img.width / 2, LETTER_IN_ENVELOPE[0], z), ay = lerp(img.height / 2, LETTER_IN_ENVELOPE[1], z);
  g.save();
  g.globalAlpha *= smooth(ramp(t, O.envIn[0], O.envIn[0] + 0.7));
  g.translate(W / 2 + (1 - e) * 300, H / 2 + 30 - (1 - e) * 140); g.rotate(-0.14 * (1 - e) * (1 - e)); g.scale(s, s);
  g.shadowColor = 'rgba(60,40,20,0.35)'; g.shadowBlur = 30; g.shadowOffsetY = 12;
  g.drawImage(img, -ax, -ay);
  g.restore();
}

// ---------------------------------------------------------------- 各场景
function drawTitleScene(g, t) {
  const O = T.opening;
  drawHome(g, t, ramp(t, O.growStart, O.growEnd));
  if (t > O.title[0].t && t < O.fadeOut[1]) {
    const u = ramp(t, O.fadeOut[0], O.fadeOut[1]);
    g.save(); blow(g, u);
    drawGlyphs(g, O.title, t, FONT.brush, 112, 1.1, INK, 4);
    drawGlyphs(g, O.ded, t, FONT.kai, 38, 0.7, '#4a3f35', 2);
    g.restore();
    g.save(); g.globalAlpha = 1 - smooth(u);
    drawSeal(g, seals.name, TITLE.x, TITLE.y + 5 * 126 + 30, ramp(t, O.titleSeal, O.titleSeal + 0.45), 0.8);
    g.restore();
  }
  drawGeese(g, t);
  drawSwirl(g, t, O.swirl, 560);
  drawEnvelope(g, t);
}

let card, panelReveal;
function makeCard() {
  const pad = 60;
  const c = mk(CARD.w + pad * 2, CARD.h + pad * 2), g = c.getContext('2d');
  g.translate(pad, pad);
  g.shadowColor = 'rgba(60,40,20,0.3)'; g.shadowBlur = 30; g.shadowOffsetY = 10;
  g.drawImage(IMG.card, 0, 0, CARD.w, CARD.h);
  g.shadowColor = 'transparent';
  // 朱丝栏
  const left = (CARD.w - CARD.cols * CARD.colPitch) / 2;
  g.strokeStyle = 'rgba(178,52,48,0.42)'; g.lineWidth = 1.4;
  g.strokeRect(left, 50, CARD.cols * CARD.colPitch, CARD.h - 100);
  g.lineWidth = 1;
  for (let i = 1; i < CARD.cols; i++) {
    const x = left + i * CARD.colPitch;
    g.beginPath(); g.moveTo(x, 50); g.lineTo(x, CARD.h - 50); g.stroke();
  }
  g.lineWidth = 2.2; g.strokeStyle = 'rgba(178,52,48,0.32)';
  g.strokeRect(left - 6, 44, CARD.cols * CARD.colPitch + 12, CARD.h - 88);
  const s = 0.42;
  put(g, IMG.corner_tl, -26, -26, s);
  put(g, IMG.corner_br, CARD.w + 26 - IMG.corner_br.width * s, CARD.h + 26 - IMG.corner_br.height * s, s);
  return { img: c, pad };
}
function drawLetterScene(g, t) {
  const L = T.letter;
  g.drawImage(IMG.wash_pink, 0, 0);
  const e = easeOut(ramp(t, L.cardIn[0], L.cardIn[1] + 0.4));
  // 竖幅画：裱边、金线，画面缓缓推近；换页时墨色晕开换画
  g.save();
  g.translate(-50 * (1 - e), 0);
  g.save();
  g.shadowColor = 'rgba(70,45,25,0.32)'; g.shadowBlur = 28; g.shadowOffsetY = 10;
  g.fillStyle = '#f1e7d2'; g.fillRect(PANEL.x - 18, PANEL.y - 18, PANEL.w + 36, PANEL.h + 36);
  g.restore();
  g.save();
  g.beginPath(); g.rect(PANEL.x, PANEL.y, PANEL.w, PANEL.h); g.clip();
  let cur = 0;
  L.pages.forEach((pg, i) => { if (t >= pg.start - 0.8) cur = i; });
  const kb = (pg, img, u) => {
    const s = 1.02 + 0.06 * ramp(t, pg.start - 0.8, pg.end + 1);
    const w = PANEL.w * s, h = PANEL.h * s;
    panelReveal.draw(g, img, u, PANEL.x - (w - PANEL.w) / 2, PANEL.y - (h - PANEL.h) * 0.7, w, h, 0.18);
  };
  if (cur > 0) kb(L.pages[cur - 1], L.pages[cur - 1].panel, 1);
  const pg = L.pages[cur];
  kb(pg, pg.panel, cur === 0 ? 1 : ramp(t, pg.start - 0.8, pg.start + 1.0));
  g.restore();
  g.strokeStyle = 'rgba(168,128,62,0.85)'; g.lineWidth = 1.6;
  g.strokeRect(PANEL.x - 7, PANEL.y - 7, PANEL.w + 14, PANEL.h + 14);
  g.restore();
  // 信笺
  g.save();
  g.translate(60 * (1 - e), 0);
  g.drawImage(card.img, CARD.x - card.pad, CARD.y - card.pad);
  drawSeal(g, IMG.plumseal, CARD.x + CARD.w - 46, CARD.y + 100, ramp(t, L.seal, L.seal + 0.45), 0.5);
  for (const pg of L.pages) {
    if (t < pg.start || t > pg.end) continue;
    g.save(); blow(g, ramp(t, pg.end - pg.fade, pg.end));
    drawGlyphs(g, pg.glyphs, t, FONT.kai, CARD.size, GLYPH_DUR, INK, 2.5);
    g.restore();
  }
  g.restore();
}

let bgReveal;
function drawPoemScene(g, t) {
  const P = T.poem, cp = P.couplets;
  // 背景
  let cur = 0;
  P.bgs.forEach((b, i) => { if (t >= b.t) cur = i; });
  if (cur > 0) g.drawImage(IMG[P.bgs[cur - 1].img], 0, 0);
  const b = P.bgs[cur];
  bgReveal.draw(g, IMG[b.img], cur === 0 ? 1 : ramp(t, b.t, b.t + b.dur), 0, 0, W, H, 0.2);
  // 金风送桂：一枝桂花自左下探入
  const ok = win(t, P.osm[0], P.osm[1], 1.4, 1.6);
  if (ok > 0) {
    g.save(); g.globalAlpha = ok;
    const s = 0.5, sway = 6 * Math.sin(t * 0.9);
    put(g, IMG.osmanthus, -40 - 60 * (1 - ok), H - IMG.osmanthus.height * s + 30 + sway, s);
    g.restore();
  }
  // 临风：一阵红梅花雨
  drawSwirl(g, t, P.swirl, 470, 0.85);
  // 书中、窗外：书卷与窗光
  const sk = win(t, P.study[0], P.study[1], 1.2, 1.2);
  if (sk > 0) {
    g.save(); g.globalAlpha = sk;
    drawRays(g, sk, t, W + 60, -80);
    put(g, IMG.books, 20, H - IMG.books.height * 0.62 + 20, 0.62);
    put(g, IMG.window, 1452, H - IMG.window.height * 0.42 - 6, 0.42);
    const ob = IMG.orbs;
    for (let i = 0; i < 3; i++) {
      g.globalAlpha = sk * (0.5 + 0.4 * Math.sin(t * 1.3 + i * 2));
      put(g, ob, 260 + i * 520 + 30 * Math.sin(t * 0.4 + i), 120 + 60 * Math.sin(t * 0.3 + i * 1.7), 0.55);
    }
    g.restore();
  }
  // 年年如意：如意结、玉佩垂下
  const hk = easeOut(ramp(t, P.hang, P.hang + 1.6));
  if (hk > 0) {
    for (const [name, x, len, ph] of [['knot', 1700, 0, 0], ['jade', 1545, 40, 1.3]]) {
      const img = IMG[name], s = 0.62, w = img.width * s, h = img.height * s;
      g.save();
      g.globalAlpha = hk;
      g.translate(x, -h + (h + len - 30) * hk);
      g.rotate(0.05 * Math.sin(t * 1.4 + ph) * (1 - 0.5 * hk));
      g.drawImage(img, -w / 2, 0, w, h);
      g.restore();
    }
  }
  // 字下垫一层淡淡的纸色，保证在各种背景上都看得清
  g.save();
  g.globalAlpha = 0.5;
  blob(g, 960, 590, 640, 470, 'rgba(250,244,230,0.9)');
  g.restore();
  if (t < P.fadeOut[1]) {
    const u = ramp(t, P.fadeOut[0], P.fadeOut[1]);
    g.save(); blow(g, u);
    drawGlyphs(g, P.glyphs, t, FONT.brush, P.layout.size, POEM_GLYPH_DUR, INK, 4);
    drawGlyphs(g, P.sig, t, FONT.brush, 40, 0.6, '#2e2823', 2);
    g.restore();
    g.save(); g.globalAlpha = 1 - smooth(u);
    drawSeal(g, seals.name, P.seal.x, P.seal.y, ramp(t, P.seal.t, P.seal.t + 0.45), 0.62);
    g.restore();
  }
}

function drawEndingScene(g, t) {
  const E = T.ending;
  drawHome(g, t, 1);
  const ck = win(t, E.start, E.end, 3, 3);
  if (ck > 0) {
    g.save(); g.globalAlpha = 0.55 * ck;
    put(g, IMG.clouds, -260 + 22 * (t - E.start), 330, 0.62);
    g.restore();
  }
  drawLanterns(g, parts.lanterns, t);
  drawGlyphs(g, E.small, t, FONT.xing, 76, 0.9, '#2b2520', 3);
  drawGlyphs(g, E.big, t, FONT.brush, 158, 1.3, INK, 5);
  drawSeal(g, seals.name, E.seal.x, E.seal.y, ramp(t, E.seal.t, E.seal.t + 0.45), 0.8);
}

// 转场时横扫过画面的水墨云
function drawInkSweep(g, t, t0, dur) {
  if (t < t0 || t > t0 + dur) return;
  const u = (t - t0) / dur;
  g.save();
  g.globalAlpha = Math.sin(Math.PI * u) * 0.9;
  const a = IMG.inkcloud1, b = IMG.inkcloud2, s = 1.5;
  g.drawImage(a, lerp(-a.width * s, W, u), 120, a.width * s, a.height * s);
  g.drawImage(b, lerp(W, -b.width * s, u), 560, b.width * s, b.height * s);
  g.restore();
}

function drawRays(g, k, t, ox, oy) {
  if (k <= 0) return;
  g.save();
  g.globalCompositeOperation = 'screen';
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * 0.62 + i * 0.075 + Math.sin(t * 0.25 + i) * 0.02;
    const len = 2000, wd = 0.018 + 0.012 * Math.sin(i * 2.1);
    const gr = g.createLinearGradient(ox, oy, ox + Math.cos(a) * len, oy + Math.sin(a) * len);
    gr.addColorStop(0, `rgba(255,224,150,${0.3 * k})`); gr.addColorStop(1, 'rgba(255,224,150,0)');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(ox, oy);
    g.lineTo(ox + Math.cos(a - wd) * len, oy + Math.sin(a - wd) * len);
    g.lineTo(ox + Math.cos(a + wd) * len, oy + Math.sin(a + wd) * len);
    g.closePath(); g.fill();
  }
  g.restore();
}

// 字被风吹走：左移、上扬、虚化、变淡
function blow(g, u) {
  if (u <= 0) return;
  g.globalAlpha *= 1 - smooth(u);
  g.translate(-80 * u * u, -16 * u);
  if (u > 0.04) g.filter = `blur(${(u * 3.5).toFixed(2)}px)`;
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
  g.globalAlpha *= clamp(p * 2.2) * 0.92;
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

// ---------------------------------------------------------------- 飘落物（花瓣、桂花、雪花、枫叶、金光）与天灯
function makeParticles() {
  const rnd = mulberry32(31337);
  const O = T.opening, L = T.letter, P = T.poem, E = T.ending, cp = P.couplets;
  const list = { petals: [], gui: [], snow: [], maple: [], spark: [], scatter: [], lanterns: [] };
  // 速率函数（每秒个数）
  const petalRate = t =>
    t < O.growEnd - 1 ? 0 :
    t < L.cardIn[0] ? 0.45 :
    t < P.start ? 0.25 :
    t < cp[1].start ? 0.15 :
    t < cp[2].start ? 0.7 :
    t < E.start ? 0.3 :
    0.6 + 1.6 * ramp(t, E.start, E.start + 6);
  const guiRate = t => 0.4 * win(t, 4, O.fadeOut[1], 2, 1) + 6 * win(t, P.osm[0] + 0.8, P.osm[1], 1.2, 1.5);
  const snowRate = t => 20 * win(t, cp[1].start - 0.3, cp[2].start - 0.8, 1.5, 1.0);
  const mapleRate = t => 1.4 * win(t, P.start, cp[1].start, 1.5, 1.2) + 1.2 * win(t, cp[3].start + 2.8, cp[3].start + 4.3, 0.4, 0.4);
  const sparkRate = t => 4 * win(t, cp[2].start, cp[3].start, 1.5, 1.5) + 4 * win(t, cp[3].start, E.start + 3, 1.5, 3) + 2 * win(t, E.start + 2, E.end, 2, 3);
  const spawn = (rate, fn) => {
    const maxR = 40;
    for (let t = 0; t < T.duration; ) {
      t += -Math.log(1 - rnd()) / maxR;
      if (rnd() * maxR < rate(t)) fn(t);
    }
  };
  spawn(petalRate, t => {
    const fromPlum = t < L.cardIn[0] || t > E.start;
    const s = fromPlum ? petalSources[Math.floor(rnd() * petalSources.length)] : { x: rnd() * W * 1.25, y: -20 };
    list.petals.push({ t0: t, x: s.x + (rnd() - 0.5) * 20, y: s.y, vx: -18 - rnd() * 40, vy: 32 + rnd() * 34,
      amp: 18 + rnd() * 34, f: 0.35 + rnd() * 0.5, ph: rnd() * 6.28, spin: (rnd() - 0.5) * 4, flip: 1.5 + rnd() * 2.5,
      r: 6 + rnd() * 4, life: 30 });
  });
  spawn(guiRate, t => {
    const opening = t < L.start;
    list.gui.push(opening
      ? { t0: t, x: 1940 + rnd() * 60, y: -60 + rnd() * 760, vx: -70 - rnd() * 90, vy: 14 + rnd() * 30 }
      : { t0: t, x: 40 + rnd() * 560, y: 760 + rnd() * 260, vx: 60 + rnd() * 110, vy: -12 - rnd() * 30 });
    Object.assign(list.gui[list.gui.length - 1],
      { amp: 10 + rnd() * 20, f: 0.4 + rnd() * 0.8, ph: rnd() * 6.28, spin: (rnd() - 0.5) * 5, r: 3.6 + rnd() * 3, life: 30 });
  });
  spawn(snowRate, t => {
    list.snow.push({ t0: t, x: rnd() * (W + 300), y: -30, vx: -14 - rnd() * 18, vy: 36 + rnd() * 44,
      amp: 6 + rnd() * 14, f: 0.3 + rnd() * 0.6, ph: rnd() * 6.28, r: 9 + rnd() * 22, spin: (rnd() - 0.5) * 1.2, k: Math.floor(rnd() * 5), life: 30 });
  });
  spawn(mapleRate, t => {
    list.maple.push({ t0: t, x: rnd() * W * 1.2, y: -50, vx: -20 - rnd() * 40, vy: 50 + rnd() * 40,
      amp: 20 + rnd() * 30, f: 0.25 + rnd() * 0.3, ph: rnd() * 6.28, spin: (rnd() - 0.5) * 2, flip: 1 + rnd() * 2,
      s: 0.3 + rnd() * 0.3, k: Math.floor(rnd() * 5), life: 26 });
  });
  spawn(sparkRate, t => {
    list.spark.push({ t0: t, x: 200 + rnd() * 1520, y: 80 + rnd() * 900, r: 5 + rnd() * 9, life: 1.4 + rnd() * 1.4, rot: rnd() });
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
  scatter([...O.title, ...O.ded], O.fadeOut[0], O.fadeOut[1]);
  for (const pg of L.pages) scatter(pg.glyphs, pg.end - pg.fade, pg.end);
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
  const drift = (p, a) => [p.x + p.vx * a + p.amp * Math.sin(p.f * a * 6.28 + p.ph), p.y + p.vy * a];
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
    const [x, y] = drift(p, a);
    if (y > H + 20 || x < -30) continue;
    drawPetal(g, x, y + 6 * Math.sin(p.f * 2 * a * 6.28), p.r, p.ph + p.spin * a, Math.cos(p.flip * a + p.ph), clamp(a * 2) * 0.9);
  }
  for (const p of list.gui) {
    const a = t - p.t0;
    if (a < 0 || a > p.life) continue;
    const [x, y] = drift(p, a);
    if (x < -20 || x > W + 80 || y > H + 20 || y < -40) continue;
    g.save(); g.translate(x, y); g.rotate(p.ph + p.spin * a);
    g.globalAlpha = clamp(a * 2);
    g.fillStyle = 'rgba(226,160,40,0.92)';
    for (let k = 0; k < 4; k++) {
      g.rotate(Math.PI / 2);
      g.beginPath(); g.ellipse(p.r * 0.55, 0, p.r * 0.6, p.r * 0.42, 0, 0, 6.2832); g.fill();
    }
    g.fillStyle = 'rgba(190,110,20,0.9)'; g.beginPath(); g.arc(0, 0, p.r * 0.25, 0, 6.2832); g.fill();
    g.restore();
  }
  for (const p of list.snow) {
    const a = t - p.t0;
    if (a < 0 || a > p.life) continue;
    const [x, y] = drift(p, a);
    if (y > H + 40 || x < -40) continue;
    const img = IMG['flake' + p.k], s = p.r * 2 / img.width;
    g.save(); g.translate(x, y); g.rotate(p.ph + p.spin * a);
    g.globalAlpha = clamp(a * 1.5) * 0.95;
    g.drawImage(img, -img.width * s / 2, -img.height * s / 2, img.width * s, img.height * s);
    g.restore();
  }
  for (const p of list.maple) {
    const a = t - p.t0;
    if (a < 0 || a > p.life) continue;
    const [x, y] = drift(p, a);
    if (y > H + 60 || x < -60) continue;
    const img = IMG['maple' + p.k];
    g.save(); g.translate(x, y); g.rotate(p.ph + p.spin * a); g.scale(p.s * (0.3 + 0.7 * Math.abs(Math.cos(p.flip * a + p.ph))), p.s);
    g.globalAlpha = clamp(a * 1.5);
    g.drawImage(img, -img.width / 2, -img.height / 2);
    g.restore();
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
      const rr = i % 2 ? r * 0.18 : r, an = i * Math.PI / 4;
      i ? g.lineTo(Math.cos(an) * rr, Math.sin(an) * rr) : g.moveTo(rr, 0);
    }
    g.closePath(); g.fill();
    g.restore();
  }
  g.globalAlpha = 1;
}

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

// ---------------------------------------------------------------- 主渲染
let T, parts, seals, scene, sctx, layer, lctx;

function reset(g, clear) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
  if (clear) g.clearRect(0, 0, W, H);
}

function render(t) {
  const O = T.opening, L = T.letter, P = T.poem, E = T.ending;
  // 场景依次接替；交接时后一个画在 layer 上，再淡入或以墨色晕开盖上去
  const SC = [
    { draw: drawTitleScene, from: -1, to: L.cardIn[1] },
    { draw: drawLetterScene, from: L.cardIn[0], fade: L.cardIn, to: P.start + 0.5, mode: 'alpha' },
    { draw: drawPoemScene, from: P.start - 1.2, fade: [P.start - 1.2, P.start + 0.5], to: E.start + 1.0, mode: 'dissolve' },
    { draw: drawEndingScene, from: E.start - 0.8, fade: [E.start - 0.8, E.start + 1.0], to: Infinity, mode: 'dissolve' },
  ];
  const active = SC.filter(s => t >= s.from && t < s.to);
  reset(sctx);
  active[0].draw(sctx, t);
  if (active[1]) {
    const s = active[1], p = ramp(t, s.fade[0], s.fade[1]);
    reset(sctx); reset(lctx, true);
    s.draw(lctx, t);
    if (s.mode === 'alpha') { sctx.globalAlpha = smooth(p); sctx.drawImage(layer, 0, 0); sctx.globalAlpha = 1; }
    else bgReveal.draw(sctx, layer, p, 0, 0, W, H, 0.2);
  }
  reset(sctx);
  drawInkSweep(sctx, t, P.start - 1.6, 2.6);
  drawInkSweep(sctx, t, E.start - 1.2, 2.6);
  drawParticles(sctx, parts, t);

  // 合成到屏幕：开头与结尾是案上的卷轴
  reset(ctx);
  const inOpen = t < O.push[1], inClose = t > E.close[0];
  if (inOpen || inClose) {
    drawScrollView(ctx, t, scene);
    const k = inOpen ? smooth(ramp(t, O.push[1] - 0.5, O.push[1])) : 1 - smooth(ramp(t, E.close[0], E.close[0] + 0.5));
    if (k > 0) { ctx.globalAlpha = k; ctx.drawImage(scene, 0, 0); ctx.globalAlpha = 1; }
  } else {
    ctx.drawImage(scene, 0, 0);
  }
  const fade = Math.max(1 - smooth(ramp(t, 0, 1.0)), smooth(ramp(t, E.fadeOut[0], E.fadeOut[1])));
  if (fade > 0) { ctx.globalAlpha = fade; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
}

// ---------------------------------------------------------------- 初始化
async function init() {
  const fonts = [[FONT.brush, 'fonts/mashanzheng.woff2'], [FONT.xing, 'fonts/zhimangxing.woff2'], [FONT.kai, 'fonts/wenkai.woff2']];
  await Promise.all([loadImages(), ...fonts.map(async ([name, url]) => {
    const f = new FontFace(name, `url(${url})`);
    await f.load(); document.fonts.add(f);
  })]);
  setupPlum();
  T = buildTimeline();
  parts = makeParticles();
  seals = { name: makeSeal(C.sealName) };
  card = makeCard();
  table = makeTable();
  sceneBuf = mk(SCROLL.inner.w, SCROLL.inner.h); sbctx = sceneBuf.getContext('2d');
  feather = makeFeather(SCROLL.inner.w, SCROLL.inner.h, 28);
  const n = noise2(77);
  panelReveal = new Reveal(IMG.panel1.width, IMG.panel1.height, (x, y) => clamp(0.65 * fbm2(n, x * 4, y * 7) + 0.35 * y), 0.25);
  bgReveal = new Reveal(W, H, (x, y) => clamp(0.6 * fbm2(n, x * 6 + 3, y * 4) + 0.4 * x), 0.25);
  scene = mk(W, H); sctx = scene.getContext('2d');
  layer = mk(W, H); lctx = layer.getContext('2d');
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
      fadeOut: T.opening.fadeOut, geeseMoon: T.opening.geeseMoon, envelope: T.opening.envIn[1],
    },
    letter: { start: T.letter.start, end: T.letter.end, pages: T.letter.pages.map(p => ({ start: p.start, end: p.end })) },
    poem: { start: T.poem.start, end: T.poem.end, couplets: T.poem.couplets.map(c => c.start), seal: T.poem.seal.t },
    ending: { start: T.ending.start, hbStart: T.ending.hbStart, seal: T.ending.seal.t, close: T.ending.close, end: T.ending.end },
    cues: T.cues,
  }),
};
})();
