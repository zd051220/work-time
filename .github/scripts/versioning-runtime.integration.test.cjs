'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const root = require('node:path').resolve(__dirname, '../..');
const coreSource = fs.readFileSync(root + '/js/versioning-core.js', 'utf8');
const pageHtml = fs.readFileSync(root + '/v5.5.html', 'utf8');
const indexHtml = fs.readFileSync(root + '/index.html', 'utf8');

function inlineScript(html, marker) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  const found = scripts.map(match => match[1]).find(source => source.includes(marker));
  assert.ok(found, '找不到包含 ' + marker + ' 的页面脚本');
  return found;
}
function element() {
  const classes = new Set();
  const listeners = {};
  return {
    textContent: '', disabled: false, href: '',
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); }
    },
    addEventListener(name, fn) { listeners[name] = fn; },
    click() { if (listeners.click) listeners.click(); },
    listeners
  };
}
function pageContext(options = {}) {
  const ids = {};
  ['updateBanner','updateNow','updateLater','updateTitle','updateNote'].forEach(id => { ids[id] = element(); });
  const assigned = [];
  const context = {
    document: { getElementById(id) { return ids[id] || null; } },
    URL,
    Date,
    Promise,
    fetch: options.fetch || (() => Promise.resolve({
      ok: true, json: () => Promise.resolve(options.info || {version:'5.6.0',url:'v5.6.0.html',note:'修复版本'})
    })),
    location: {
      href: 'https://example.test/work-time/v5.5.html',
      origin: 'https://example.test',
      assign(value) { assigned.push(value); },
      replace(value) { assigned.push(value); }
    },
    console
  };
  context.window = context;
  if (options.loadCore !== false) vm.runInNewContext(coreSource, context, {filename:'js/versioning-core.js'});
  return {context, ids, assigned};
}
async function settle() {
  await new Promise(resolve => setImmediate(resolve));
}

test('网页先加载共享核心，再执行版本检查脚本', () => {
  const pageCore = pageHtml.indexOf('<script src="js/versioning-core.js"></script>');
  const pageCheck = pageHtml.indexOf("var CURRENT_VERSION='5.5'");
  const indexCore = indexHtml.indexOf('<script src="js/versioning-core.js"></script>');
  const indexCheck = indexHtml.indexOf('var done=false');
  assert.ok(pageCore >= 0 && pageCore < pageCheck);
  assert.ok(indexCore >= 0 && indexCore < indexCheck);
});

test('新 SemVer 稳定版高于当前预发布版本时显示更新提示', async () => {
  const {context, ids} = pageContext({info:{version:'5.6.0',url:'v5.6.0.html',note:'正式版上线'}});
  vm.runInNewContext(inlineScript(pageHtml,'var CURRENT_VERSION'), context);
  await settle();
  assert.equal(ids.updateBanner.classList.contains('show'), true);
  assert.equal(ids.updateTitle.textContent, '发现新版本 v5.6.0');
  assert.equal(ids.updateNote.textContent, '正式版上线');
});

test('点击稍后只关闭提示，不进行页面跳转', async () => {
  const {context, ids, assigned} = pageContext();
  vm.runInNewContext(inlineScript(pageHtml,'var CURRENT_VERSION'), context);
  await settle();
  ids.updateLater.click();
  assert.equal(ids.updateBanner.classList.contains('show'), false);
  assert.deepEqual(assigned, []);
});

test('点击立即更新跳转到经过验证的站内页面', async () => {
  const {context, ids, assigned} = pageContext();
  vm.runInNewContext(inlineScript(pageHtml,'var CURRENT_VERSION'), context);
  await settle();
  ids.updateNow.click();
  assert.equal(assigned.length, 1);
  assert.match(assigned[0], /^https:\/\/example\.test\/work-time\/v5\.6\.0\.html\?update=/);
  assert.equal(ids.updateNow.disabled, true);
});

test('非法 SemVer 和非法配置不显示更新提示', async () => {
  for (const info of [
    {version:'5.6.abc',url:'v5.6.0.html',note:''},
    {version:'05.6.0',url:'v5.6.0.html',note:''},
    {version:'5.6.0-01',url:'v5.6.0.html',note:''}
  ]) {
    const {context, ids} = pageContext({info});
    vm.runInNewContext(inlineScript(pageHtml,'var CURRENT_VERSION'), context);
    await settle();
    assert.equal(ids.updateBanner.classList.contains('show'), false);
  }
});

test('跨域 URL 不显示提示，也不能跳转', async () => {
  const {context, ids, assigned} = pageContext({
    info:{version:'5.6.0',url:'https://attacker.example/update.html',note:'更新'}
  });
  vm.runInNewContext(inlineScript(pageHtml,'var CURRENT_VERSION'), context);
  await settle();
  assert.equal(ids.updateBanner.classList.contains('show'), false);
  ids.updateNow.click();
  assert.deepEqual(assigned, []);
});

test('网络请求失败不显示提示且不影响页面运行', async () => {
  const {context, ids} = pageContext({fetch:() => Promise.reject(new Error('offline'))});
  assert.doesNotThrow(() => vm.runInNewContext(inlineScript(pageHtml,'var CURRENT_VERSION'), context));
  await settle();
  assert.equal(ids.updateBanner.classList.contains('show'), false);
});

test('共享核心加载失败时旧页面不显示更新提示', async () => {
  const {context, ids} = pageContext({loadCore:false});
  vm.runInNewContext(inlineScript(pageHtml,'var CURRENT_VERSION'), context);
  await settle();
  assert.equal(ids.updateBanner.classList.contains('show'), false);
});

test('首页共享核心加载失败时回退进入 v5.5', async () => {
  const assigned = [];
  let timerCallback;
  let cleared = false;
  const context = {
    window: {},
    URL,
    Promise,
    Date,
    console,
    location: {
      href:'https://example.test/work-time/',
      origin:'https://example.test',
      replace(value) { assigned.push(value); }
    },
    setTimeout(fn) { timerCallback = fn; return 7; },
    clearTimeout(id) { if (id === 7) cleared = true; },
    fetch:() => Promise.resolve({
      ok:true,
      json:() => Promise.resolve({version:'5.6.0',url:'v5.6.0.html',note:''})
    })
  };
  context.window = context;
  vm.runInNewContext(inlineScript(indexHtml,'var done=false'), context);
  await settle();
  assert.equal(cleared, true);
  assert.deepEqual(assigned, ['v5.5.html']);
  assert.equal(typeof timerCallback, 'function');
});
