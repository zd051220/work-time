'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('v5.5.html', 'utf8');

test('four illustrated PNG characters and a separate bullion prop are wired in', () => {
  const assets = [
    'assets/cats/soft-bell/idle.png',
    'assets/cats/sport-headband/idle.png',
    'assets/cats/sleepy-nightcap/idle.png',
    'assets/cats/leader-crown/idle.png'
  ];
  for (let i = 0; i < 4; i++) assert.ok(html.includes('class="cat-art cat-art-' + i + '"'));
  for (const asset of assets) {
    assert.ok(html.includes('src="' + asset + '"'), asset + ' must be referenced');
    assert.ok(fs.existsSync(asset), asset + ' must exist');
  }
  assert.equal((html.match(/class="gold-bar"/g) || []).length, 1);
  assert.match(html, /GOLD/);
});

test('timer state resolver maps every supported state and safe fallbacks', () => {
  const source = html.match(/function mwResolveCatMode\([^)]*\)\{[^}]*\}/);
  assert.ok(source, 'state resolver must exist');
  const context = {};
  vm.runInNewContext(source[0] + '; result = mwResolveCatMode;', context);
  const resolve = context.result;
  assert.equal(resolve(null, 100, 0, 0), 'idle');
  assert.equal(resolve({ mode: 'work' }, 100, 0, 0), 'work');
  assert.equal(resolve({ mode: 'paid' }, 100, 0, 0), 'paid');
  assert.equal(resolve({ mode: 'unpaid' }, 100, 0, 0), 'unpaid');
  assert.equal(resolve(null, 100, 0, 200), 'off');
  assert.equal(resolve({ mode: 'work', pendingReview: {} }, 100, 0, 0), 'idle');
  assert.equal(resolve({ mode: 'work' }, 100, 200, 0), 'petted');
  assert.equal(resolve({ mode: 'unexpected' }, 100, 0, 0), 'idle');
});

test('cat interactions are separate from accounting and storage', () => {
  const i = html.indexOf("$('cat').addEventListener('click'");
  const j = html.indexOf("$('startBtn').onclick", i);
  assert.ok(i >= 0 && j > i);
  assert.doesNotMatch(html.slice(i, j), /localStorage|data\.records|save\(|accrue\(/);
});

test('reduced motion and keyboard interaction remain supported', () => {
  assert.match(html, /prefers-reduced-motion:reduce/);
  assert.match(html, /e\.key==='Enter'/);
});
