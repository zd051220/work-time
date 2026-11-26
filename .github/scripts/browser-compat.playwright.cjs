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

    if (name === 'Chromium') {
      await test('手机休眠 5 小时：墙钟与服务器一致时静默补计', async () => {
        const context = await makeContext(browser, origin);
        const page = await context.newPage();
        let serverOffset = 0;
        await page.addInitScript(() => {
          const realNow = Date.now.bind(Date);
          const realPerf = performance.now.bind(performance);
          window.__testClock = { wall: 0, mono: 0 };
          window.__testVisibility = { hidden: false };
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__testVisibility.hidden });
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__testVisibility.hidden ? 'hidden' : 'visible' });
          window.__setTestVisibility = hidden => {
            window.__testVisibility.hidden = !!hidden;
            document.dispatchEvent(new Event('visibilitychange'));
          };
          Date.now = () => realNow() + window.__testClock.wall;
          Object.defineProperty(performance, 'now', {
            configurable: true,
            value: () => realPerf() + window.__testClock.mono
          });
        });
        await page.route('https://zemrafvmhfxqdeqauejt.supabase.co/auth/v1/health', async route => {
          const headers = {
            'access-control-allow-origin': origin,
            'access-control-allow-methods': 'GET, OPTIONS',
            'access-control-allow-headers': 'apikey',
            'access-control-expose-headers': 'Date',
            'content-type': 'application/json',
            'date': new Date(Date.now() + serverOffset).toUTCString()
          };
          if (route.request().method() === 'OPTIONS') {
            return route.fulfill({ status: 204, headers });
          }
          return route.fulfill({ status: 200, headers, body: '{"ok":true}' });
        });
        const initialClockResponse = page.waitForResponse(response => response.url().includes('/auth/v1/health') && response.status() === 200);
        await page.goto(origin + '/v5.5.html');
        await initialClockResponse;
        await page.locator('#startBtn').click();
        await page.evaluate(() => window.__setTestVisibility(true));
        await page.waitForFunction(() => document.hidden === true);
        const fiveHours = 5 * 60 * 60 * 1000;
        serverOffset = fiveHours;
        await page.evaluate(ms => { window.__testClock.wall += ms; }, fiveHours);
        await page.evaluate(() => window.__setTestVisibility(false));
        await page.waitForFunction(() => document.hidden === false);
        await page.waitForFunction(() => {
          const saved = JSON.parse(localStorage.getItem('catGold_v5') || 'null');
          return saved && saved.session && !saved.session.pendingReview &&
            saved.session.workMs >= 5 * 60 * 60 * 1000;
        }, null, { timeout: 10000 });
        await context.close();
      });

      await test('后台将系统时间与单调钟同时快进 1 小时：顶部横幅出现且工资冻结', async () => {
        const context = await makeContext(browser, origin);
        const page = await context.newPage();
        let serverOffset = 0;
        await page.addInitScript(() => {
          const realNow = Date.now.bind(Date);
          const realPerf = performance.now.bind(performance);
          window.__testClock = { wall: 0, mono: 0 };
          window.__testVisibility = { hidden: false };
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__testVisibility.hidden });
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__testVisibility.hidden ? 'hidden' : 'visible' });
          window.__setTestVisibility = hidden => {
            window.__testVisibility.hidden = !!hidden;
            document.dispatchEvent(new Event('visibilitychange'));
          };
          Date.now = () => realNow() + window.__testClock.wall;
          Object.defineProperty(performance, 'now', {
            configurable: true,
            value: () => realPerf() + window.__testClock.mono
          });
        });
        await page.route('https://zemrafvmhfxqdeqauejt.supabase.co/auth/v1/health', async route => {
          const headers = {
            'access-control-allow-origin': origin,
            'access-control-allow-methods': 'GET, OPTIONS',
            'access-control-allow-headers': 'apikey',
            'access-control-expose-headers': 'Date',
            'content-type': 'application/json',
            'date': new Date(Date.now() + serverOffset).toUTCString()
          };
          if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
          return route.fulfill({ status: 200, headers, body: '{"ok":true}' });
        });
        const initialClockResponse = page.waitForResponse(response => response.url().includes('/auth/v1/health') && response.status() === 200);
        await page.goto(origin + '/v5.5.html');
        await initialClockResponse;
        await page.locator('#startBtn').click();
        await page.waitForTimeout(250);
        const before = await page.evaluate(() => JSON.parse(localStorage.getItem('catGold_v5') || 'null').session.workMs);
        await page.evaluate(() => window.__setTestVisibility(true));
        await page.waitForFunction(() => document.hidden === true);
        const oneHour = 60 * 60 * 1000;
        await page.evaluate(ms => {
          window.__testClock.wall += ms;
          window.__testClock.mono += ms;
        }, oneHour);
        serverOffset = -oneHour;
        await page.evaluate(() => window.__setTestVisibility(false));
        await page.waitForFunction(() => document.hidden === false);
        await page.locator('#clockReviewBanner').waitFor({ state: 'visible', timeout: 10000 });
        await page.waitForFunction(() => {
          const saved = JSON.parse(localStorage.getItem('catGold_v5') || 'null');
          return saved && saved.session && !!saved.session.pendingReview;
        }, null, { timeout: 10000 });
        const pending = await page.evaluate(() => JSON.parse(localStorage.getItem('catGold_v5') || 'null').session);
        if (pending.workMs > before + 5000) throw new Error('异常的 1 小时已被计入工作时长');
        if (await page.locator('#stopBtn').isEnabled()) throw new Error('核对期间下班按钮没有被冻结');
        await page.waitForTimeout(1800);
        const afterWait = await page.evaluate(() => JSON.parse(localStorage.getItem('catGold_v5') || 'null').session.workMs);
        if (afterWait !== pending.workMs) throw new Error('待核对期间工时仍在增长');
        await page.locator('#clockReviewBanner').click();
        await page.locator('#reviewBox').waitFor({ state: 'visible' });
        await page.locator('#reviewInclude').waitFor({ state: 'visible' });
        await page.locator('#reviewDiscard').waitFor({ state: 'visible' });
        await page.locator('#reviewEndTime').waitFor({ state: 'visible' });
        await context.close();
      });

      await test('系统时间比服务器快 30 分钟：强制人工核对', async () => {
        const context = await makeContext(browser, origin);
        const page = await context.newPage();
        let serverOffset = 0;
        await page.addInitScript(() => {
          const realNow = Date.now.bind(Date);
          const realPerf = performance.now.bind(performance);
          window.__testClock = { wall: 0, mono: 0 };
          window.__testVisibility = { hidden: false };
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__testVisibility.hidden });
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__testVisibility.hidden ? 'hidden' : 'visible' });
          window.__setTestVisibility = hidden => {
            window.__testVisibility.hidden = !!hidden;
            document.dispatchEvent(new Event('visibilitychange'));
          };
          Date.now = () => realNow() + window.__testClock.wall;
          Object.defineProperty(performance, 'now', {
            configurable: true,
            value: () => realPerf() + window.__testClock.mono
          });
        });
        await page.route('https://zemrafvmhfxqdeqauejt.supabase.co/auth/v1/health', async route => {
          const headers = {
            'access-control-allow-origin': origin,
            'access-control-allow-methods': 'GET, OPTIONS',
            'access-control-allow-headers': 'apikey',
            'access-control-expose-headers': 'Date',
            'content-type': 'application/json',
            'date': new Date(Date.now() + serverOffset).toUTCString()
          };
          if (route.request().method() === 'OPTIONS') {
            return route.fulfill({ status: 204, headers });
          }
          return route.fulfill({ status: 200, headers, body: '{"ok":true}' });
        });
        const initialClockResponse = page.waitForResponse(response => response.url().includes('/auth/v1/health') && response.status() === 200);
        await page.goto(origin + '/v5.5.html');
        await initialClockResponse;
        await page.locator('#startBtn').click();
        await page.evaluate(() => window.__setTestVisibility(true));
        await page.waitForFunction(() => document.hidden === true);
        const fiveHours = 5 * 60 * 60 * 1000;
        serverOffset = fiveHours;
        await page.evaluate(ms => { window.__testClock.wall += ms + 30 * 60 * 1000; }, fiveHours);
        await page.evaluate(() => window.__setTestVisibility(false));
        await page.waitForFunction(() => document.hidden === false);
        await page.waitForFunction(() => {
          const saved = JSON.parse(localStorage.getItem('catGold_v5') || 'null');
          return saved && saved.session && !!saved.session.pendingReview;
        }, null, { timeout: 10000 });
        await context.close();
      });
    }

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
      const frameOrigin = await frame.locator('body').evaluate(() => location.origin);
      if (!childMessages.some(message =>
        message.type === 'game-rpc-result' && message.fromParent && message.origin === frameOrigin
      )) {
        throw new Error('游戏 iframe 没有收到来自父页面、且来源与 iframe 同源的 RPC 响应');
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
