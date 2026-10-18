// 从画面引擎导出时间线，供配乐脚本对齐：node tools/timeline.mjs > build/timeline.json
// 优先使用本地安装的 playwright，找不到时用全局安装的
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright')
  .catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'));
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'src');
const b = await chromium.launch();
const p = await b.newPage();
await p.goto('file://' + root + '/index.html?record');
await p.evaluate(() => FILM.ready);
console.log(JSON.stringify(await p.evaluate(() => FILM.timeline()), null, 1));
await b.close();
