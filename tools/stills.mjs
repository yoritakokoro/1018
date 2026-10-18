// 渲染若干时间点的静帧，用于检查画面：node tools/stills.mjs out_dir t1 t2 ...
// 优先使用本地安装的 playwright，找不到时用全局安装的
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright')
  .catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'));
import fs from 'node:fs';
import path from 'node:path';
const [,, outDir, ...times] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'src');
const b = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.on('console', m => console.log('[page]', m.text()));
p.on('pageerror', e => console.log('[pageerror]', e.message));
await p.goto('file://' + root + '/index.html?record');
await p.evaluate(() => FILM.ready);
console.log(JSON.stringify(await p.evaluate(() => FILM.timeline())));
for (const t of times) {
  const t0 = Date.now();
  const data = await p.evaluate(t => { FILM.render(t); return document.getElementById('film').toDataURL('image/jpeg', 0.9); }, +t);
  fs.writeFileSync(path.join(outDir, `t${String(t).padStart(6, '0')}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
  console.log('t=', t, Date.now() - t0, 'ms');
}
await b.close();
