// 逐帧渲染画面：node tools/render.mjs <输出目录> [fps=30] [并行数=4]
// 每个 worker 打开一个页面，按帧号轮流渲染，保存为 JPEG；已存在的帧会跳过。
import fs from 'node:fs';
import path from 'node:path';
import { launch, frame } from './film-page.mjs';

const [,, outDir, fpsArg = '30', jobsArg = '4'] = process.argv;
const fps = +fpsArg, jobs = +jobsArg;
fs.mkdirSync(outDir, { recursive: true });

const film = await launch();
const probe = await film.page({ width: 640, height: 360 });
const duration = await probe.evaluate(() => FILM.duration);
await probe.close();
const total = Math.ceil(duration * fps);
console.log(`${total} frames, ${duration.toFixed(2)}s @ ${fps}fps, ${jobs} workers`);

let done = 0;
const t0 = Date.now();
async function worker(w) {
  const page = await film.page();
  for (let i = w; i < total; i += jobs) {
    const file = path.join(outDir, String(i).padStart(5, '0') + '.jpg');
    if (!fs.existsSync(file)) fs.writeFileSync(file, await frame(page, i / fps));
    if (++done % 250 === 0) {
      const el = (Date.now() - t0) / 1000;
      console.log(`${done}/${total}  ${el.toFixed(0)}s elapsed, ~${(el / done * (total - done)).toFixed(0)}s left`);
    }
  }
  await page.close();
}
await Promise.all(Array.from({ length: jobs }, (_, w) => worker(w)));
await film.close();
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
