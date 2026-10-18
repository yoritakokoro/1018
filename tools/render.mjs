// 逐帧渲染画面：node tools/render.mjs <输出目录> [fps=30] [并行数=4]
// 每个 worker 打开一个页面，按帧号轮流渲染，保存为 JPEG。
// 优先使用本地安装的 playwright，找不到时用全局安装的
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright')
  .catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'));
import fs from 'node:fs';
import path from 'node:path';

const [,, outDir, fpsArg = '30', jobsArg = '4'] = process.argv;
const fps = +fpsArg, jobs = +jobsArg;
fs.mkdirSync(outDir, { recursive: true });
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'src');

const browser = await chromium.launch();
const probe = await browser.newPage();
await probe.goto('file://' + root + '/index.html?record');
const duration = await probe.evaluate(async () => { await FILM.ready; return FILM.duration; });
await probe.close();
const total = Math.ceil(duration * fps);
console.log(`${total} frames, ${duration.toFixed(2)}s @ ${fps}fps, ${jobs} workers`);

let done = 0;
const t0 = Date.now();
async function worker(w) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto('file://' + root + '/index.html?record');
  await page.evaluate(() => FILM.ready);
  for (let i = w; i < total; i += jobs) {
    const file = path.join(outDir, String(i).padStart(5, '0') + '.jpg');
    if (fs.existsSync(file)) { done++; continue; }
    const data = await page.evaluate(t => {
      FILM.render(t);
      return document.getElementById('film').toDataURL('image/jpeg', 0.95);
    }, i / fps);
    fs.writeFileSync(file, Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'));
    if (++done % 250 === 0) {
      const el = (Date.now() - t0) / 1000;
      console.log(`${done}/${total}  ${el.toFixed(0)}s elapsed, ~${(el / done * (total - done)).toFixed(0)}s left`);
    }
  }
  await page.close();
}
await Promise.all(Array.from({ length: jobs }, (_, w) => worker(w)));
await browser.close();
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
