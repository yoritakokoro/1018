// 从画面引擎导出时间线，供配乐脚本对齐：node tools/timeline.mjs > build/timeline.json
import { launch } from './film-page.mjs';

const film = await launch();
const page = await film.page({ width: 640, height: 360 });
console.log(JSON.stringify(await page.evaluate(() => FILM.timeline()), null, 1));
await film.close();
