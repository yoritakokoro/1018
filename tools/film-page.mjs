// 在本地 HTTP 服务器上打开短片页面（直接用 file:// 打开时，读取画布像素会被浏览器拦下）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// 优先使用本地安装的 playwright，找不到时用全局安装的
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright')
  .catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'));

export const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'src');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.m4a': 'audio/mp4', '.png': 'image/png',
};

function serve(root) {
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

export async function launch() {
  const server = await serve(SRC);
  const url = `http://127.0.0.1:${server.address().port}/index.html?record`;
  const browser = await chromium.launch();
  return {
    async page(viewport = { width: 1920, height: 1080 }) {
      const p = await browser.newPage({ viewport });
      p.on('pageerror', e => console.log('[pageerror]', e.message));
      p.on('console', m => { if (m.type() === 'error') console.log('[console]', m.text()); });
      await p.goto(url);
      await p.evaluate(() => FILM.ready);
      return p;
    },
    async close() { await browser.close(); server.close(); },
  };
}

// 渲染第 t 秒并取回 JPEG
export async function frame(page, t, quality = 0.95) {
  const data = await page.evaluate(([t, q]) => {
    FILM.render(t);
    return document.getElementById('film').toDataURL('image/jpeg', q);
  }, [t, quality]);
  return Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
}
