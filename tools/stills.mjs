// 渲染若干时间点的静帧，用于检查画面：node tools/stills.mjs <输出目录> t1 t2 ...
import fs from 'node:fs';
import path from 'node:path';
import { launch, frame } from './film-page.mjs';

const [,, outDir, ...times] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const film = await launch();
const page = await film.page();
for (const t of times) {
  const t0 = Date.now();
  fs.writeFileSync(path.join(outDir, `t${String(t).padStart(6, '0')}.jpg`), await frame(page, +t, 0.9));
  console.log('t=', t, Date.now() - t0, 'ms');
}
await film.close();
