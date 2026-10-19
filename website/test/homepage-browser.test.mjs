import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ChromeVisualBrowser, findChrome } from '../../archify/bin/visual-check.mjs';

const website = fileURLToPath(new URL('../', import.meta.url));
const enabled = process.env.ARCHIFY_SITE_INTEGRATION === '1';
const root = path.resolve(process.env.ARCHIFY_SITE_ROOT || path.join(website, 'dist'));
const mount = process.env.ARCHIFY_SITE_BASE ?? '/archify';
const target = mount ? 'github' : 'cloudflare';
const output = path.join(website, '.browser-evidence', target);

test('real Chrome: homepage category and identity remain readable across languages, themes and viewports', {
  skip: enabled ? false : 'Set ARCHIFY_SITE_INTEGRATION=1 and ARCHIFY_CHROME to run homepage browser evidence.',
  timeout: 120000,
}, async () => {
  const chrome = findChrome();
  assert.ok(chrome, 'The requested homepage gate requires usable Chrome.');
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (mount && !url.pathname.startsWith(`${mount}/`)) return response.writeHead(404).end();
    let relative = url.pathname.slice(mount.length).replace(/^\/+/, '') || 'index.html';
    if (relative === 'zh') relative = 'zh.html';
    const file = path.resolve(root, relative);
    if (!file.startsWith(`${root}${path.sep}`)) return response.writeHead(404).end();
    try {
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
      response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      response.end(fs.readFileSync(file));
    } catch { response.writeHead(404).end(); }
  });
  let browser;
  fs.mkdirSync(output, { recursive: true });
  const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : null;
  const manifest = {
    capturedAt: new Date().toISOString(), target,
    checkoutSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: website, encoding: 'utf8' }).trim(),
    pullRequestHead: event?.pull_request?.head?.sha || null,
    runId: process.env.GITHUB_RUN_ID || null,
    screenshots: [],
  };
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = new ChromeVisualBrowser(chrome);
    const session = await browser.sessionPromise;
    const evaluate = async expression => {
      const result = await browser.cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await browser.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, session);
    for (const width of [1440, 390, 320]) for (const lang of ['en', 'zh']) {
      await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 }, session);
      const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
      loaded.catch(() => {});
      await browser.cdp.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}${mount}/${lang === 'zh' ? (mount ? 'zh.html' : 'zh') : ''}` }, session);
      await loaded;
      await evaluate('document.fonts.ready');
      for (const theme of ['light', 'dark']) {
        await evaluate(`(async () => {
          if (document.documentElement.dataset.theme !== ${JSON.stringify(theme)}) document.querySelector('[data-theme-toggle]').click();
          scrollTo(0, 0);
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        })()`);
        for (const region of ['hero', 'identity', 'guide-discovery']) {
          if (region === 'identity') await evaluate(`document.querySelector('.facts-identity').scrollIntoView({block:'center',behavior:'instant'})`);
          if (region === 'guide-discovery') await evaluate(`document.querySelector('.guide-discovery').scrollIntoView({block:'center',behavior:'instant'})`);
          await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
          const receipt = await evaluate(`(() => {
            const selectors = ${JSON.stringify(region === 'hero' ? ['.hero h1', '.hero-sub', '.hero-eyebrow', '.cmd-chip', '.cmd-copy', '.hero-actions .btn'] : region === 'identity' ? ['.facts-identity', '.facts-identity a'] : ['.guide-discovery a'])};
            const scope = ${JSON.stringify(region)} === 'hero' ? document.querySelector('.hero-copy') : document;
            return { lang: document.documentElement.lang, theme: document.documentElement.dataset.theme,
              viewport: innerWidth, scrollY, pageWidth: document.documentElement.scrollWidth,
              nodes: selectors.flatMap(selector => [...scope.querySelectorAll(selector)].map(node => {
                const box = node.getBoundingClientRect(), style = getComputedStyle(node);
                return { rect: { x: box.x, y: box.y, width: box.width, height: box.height }, text: node.innerText, href: node.getAttribute('href'), visible: box.width > 0 && box.height > 0 && style.visibility === 'visible' && Number(style.opacity) === 1,
                  fits: [...node.getClientRects()].every(rect => rect.left >= -1 && rect.right <= innerWidth + 1),
                  inView: box.top >= 0 && box.bottom <= innerHeight };
              })) };
          })()`);
          const name = `${lang}-${width}-${theme}-${region}.png`;
          const image = await browser.cdp.send('Page.captureScreenshot', { format: 'png' }, session);
          fs.writeFileSync(path.join(output, name), Buffer.from(image.data, 'base64'));
          manifest.screenshots.push({ file: name, width, height: 1000, lang, theme, region, receipt });
          fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
          assert.equal(receipt.lang, lang === 'en' ? 'en' : 'zh-Hans');
          assert.equal(receipt.theme, theme);
          assert.equal(receipt.viewport, width, `${name}: requested layout viewport`);
          assert.ok(receipt.pageWidth <= receipt.viewport + 1, `${name}: no page overflow`);
          assert.equal(receipt.nodes.length, region === 'hero' ? 7 : region === 'identity' ? 3 : 1);
          for (const node of receipt.nodes) assert.ok(node.visible && node.fits && node.inView, `${name}: readable ${node.text}`);
          if (region === 'hero') {
            assert.match(receipt.nodes[0].text, lang === 'en' ? /answers/ : /图和答案/);
            assert.match(receipt.nodes[1].text, /AI agent|AI Agent/);
            assert.match(receipt.nodes[1].text, /one-page answer|解答/);
          } else if (region === 'guide-discovery') {
            assert.match(receipt.nodes[0].text, lang === 'en' ? /create and check diagrams/ : /画图并检查结果/);
            assert.equal(receipt.nodes[0].href, `${lang === 'zh' ? 'zh/' : ''}agent-diagrams${mount ? '.html' : ''}`);
          } else {
            assert.deepEqual(receipt.nodes.slice(1).map(node => [node.text, node.href]), [
              ['archify.si', 'https://archify.si/'], ['tt-a1i/archify', 'https://github.com/tt-a1i/archify'],
            ]);
          }
        }
      }
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
