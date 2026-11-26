'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      const target = path.resolve(ROOT, '.' + pathname);
      if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      fs.readFile(target, (error, body) => {
        if (error) {
          res.writeHead(error.code === 'ENOENT' ? 404 : 500).end('not found');
          return;
        }
        res.writeHead(200, {
          'content-type': MIME[path.extname(target)] || 'application/octet-stream',
          'cache-control': 'no-store'
        });
        res.end(body);
      });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, origin: 'http://127.0.0.1:' + address.port });
    });
  });
}

async function makeContext(browser, origin, options) {
  const context = await browser.newContext();
  if (options && options.forceStorageFallback) {
    await context.addInitScript(() => {
      try {
        Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
      } catch (e) {}
      try {
        Object.defineProperty(window, 'BroadcastChannel', { configurable: true, value: undefined });
      } catch (e) {}
    });
  }
  await context.addInitScript(() => {
    try { localStorage.setItem('mw_notice_55', String(Date.now())); } catch (e) {}
  });
  await context.addInitScript(() => {
    window.__browserCompatMessages = [];
    window.addEventListener('message', function (event) {
      var data = event && event.data;
      if (data && (data.type === 'game-rpc' || data.type === 'game-rpc-result')) {
        window.__browserCompatMessages.push({
          type: data.type,
          origin: event.origin,
          fromParent: event.source === window.parent
        });
      }
    });
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    return route.continue();
  });
  return context;
}


async function expectVersionInfo(page, info) {
  await page.route('**/version.json*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(info)
  }));
}

async function test(name, fn) {
  await fn();
  console.log('  PASS ' + name);
}

async function runEngine(name, type, origin) {
  console.log('\n[' + name + ']');
  const browser = await type.launch({ headless: true });
  try {
    await test('首页加载共享核心并按有效配置进入正式页面', async () => {
      const context = await makeContext(browser, origin);
      const page = await context.newPage();
      await expectVersionInfo(page, { version: '5.5', url: 'v5.5.html', note: '当前正式版' });
      await page.goto(origin + '/index.html');
      await page.waitForURL(/\/v5\.5\.html\?release=5\.5$/);
      if (!(await page.evaluate(() => !!window.VersioningCore))) {
        throw new Error('首页进入正式页后未加载共享核心');
      }
      await context.close();
    });

    await test('SemVer 新版本提示、稍后关闭和立即更新跳转', async () => {
      const context = await makeContext(browser, origin);
      const page = await context.newPage();
      await expectVersionInfo(page, { version: '5.6.0', url: 'v5.5.html', note: '浏览器测试更新' });
      await page.goto(origin + '/v5.5.html');
      const banner = page.locator('#updateBanner');
      await banner.waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.getElementById('updateBanner').classList.contains('show'));
      if (!(await page.locator('#updateTitle').textContent()).includes('5.6.0')) {
        throw new Error('更新提示未显示正确的 SemVer 版本');
      }
      await page.locator('#updateLater').click();
      await page.waitForFunction(() => !document.getElementById('updateBanner').classList.contains('show'));
      await page.reload();
      await page.waitForFunction(() => document.getElementById('updateBanner').classList.contains('show'));
      await page.locator('#updateNow').click();
      await page.waitForURL(/\/v5\.5\.html\?update=/);
      await context.close();
    });

    await test('断网时首页回退到 v5.5，正式页面仍可操作', async () => {
      const context = await makeContext(browser, origin);
      const page = await context.newPage();
      await page.route('**/version.json*', route => route.abort());
      await page.goto(origin + '/index.html');
      await page.waitForURL(/\/v5\.5\.html\?release=5\.5$/);
      if (!(await page.locator('#startBtn').isVisible())) {
        throw new Error('断网回退后正式页面没有正常显示');
      }
      await page.waitForFunction(() => !!window.VersioningCore);
      await context.close();
    });

    await test('两个标签页在无 Web Locks / BroadcastChannel 时仍只有一个计时写者', async () => {
      const context = await makeContext(browser, origin, { forceStorageFallback: true });
      const first = await context.newPage();
      const second = await context.newPage();
      await first.goto(origin + '/v5.5.html');
      await first.waitForFunction(() => {
        var button = document.getElementById('startBtn');
        var lease = JSON.parse(localStorage.getItem('mw_lease_v53') || 'null');
        return button && !button.disabled && lease && lease.tab;
      }, null, { timeout: 10000 });
      await second.goto(origin + '/v5.5.html');
      await second.waitForFunction(() => {
        var bar = document.getElementById('writerBar');
        return bar && /只读/.test(bar.textContent);
      }, null, { timeout: 10000 });
      if (await second.locator('#startBtn').isEnabled()) {
        throw new Error('第二个标签页仍能开始计时');
      }
      await first.locator('#startBtn').click();
      await first.waitForFunction(() => {
        var status = document.getElementById('status');
        return status && /正在工作/.test(status.textContent);
      });
      if (await second.locator('#startBtn').isEnabled()) {
        throw new Error('第一个标签页开始计时后，第二个标签页没有保持只读');
      }
      const saved = await first.evaluate(() => JSON.parse(localStorage.getItem('catGold_v5') || 'null'));
      if (!saved || !saved.session) throw new Error('第一个标签页开始计时后没有保存本地 session');
      await context.close();
    });

    await test('游戏 iframe 加载成功并完成同源 postMessage 请求/响应', async () => {
      const context = await makeContext(browser, origin);
      const page = await context.newPage();
      await page.route('**/version.json*', route => route.abort());
      await page.goto(origin + '/v5.5.html');
      await page.locator('[data-t="tab-game"]').click();
      await page.locator('#gameStartBtn').click();
      const iframe = page.locator('#game-play-frame');
      await iframe.waitFor({ state: 'visible' });
      const frame = await iframe.contentFrame();
      if (!frame) throw new Error('无法取得游戏 iframe');
      await frame.locator('#home').waitFor({ state: 'visible' });
      await page.waitForFunction(() => window.__browserCompatMessages.some(message =>
        message.type === 'game-rpc' && message.origin === location.origin
      ), null, { timeout: 10000 });
      await frame.locator('#connection').filter({ hasText: '云端未连接' }).waitFor({
        state: 'visible',
        timeout: 10000
      });
      const childMessages = await frame.locator('body').evaluate(() => window.__browserCompatMessages || []);
      if (!childMessages.some(message =>
        message.type === 'game-rpc-result' && message.fromParent && message.origin === origin
      )) {
        throw new Error('游戏 iframe 没有收到父页面返回的同源 RPC 响应');
      }
      await context.close();
    });
  } finally {
    await browser.close();
  }
}

(async () => {
  const { server, origin } = await startServer();
  try {
    await runEngine('Chromium', chromium, origin);
    await runEngine('WebKit', webkit, origin);
    console.log('\n浏览器兼容测试全部通过：Chromium + WebKit');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
