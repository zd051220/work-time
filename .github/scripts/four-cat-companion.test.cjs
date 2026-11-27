'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('v5.5.html', 'utf8');

const ROLES = ['soft-bell', 'sport-headband', 'sleepy-nightcap', 'leader-crown'];
const STATES = ['idle', 'work', 'paid', 'unpaid', 'off', 'interaction'];
const PREVIEW = 'cat-companion-preview.html';

test('four illustrated PNG characters are wired in without a separate bullion SVG', () => {
  for (let i = 0; i < 4; i++) {
    assert.ok(html.includes('class="cat-art cat-art-' + i + '"'), 'cat-art-' + i + ' must exist');
    assert.ok(html.includes('data-role="' + ROLES[i] + '"'), ROLES[i] + ' role must be declared');
  }
  assert.equal((html.match(/class="gold-bar"/g) || []).length, 0, 'gold bar is part of the artwork now');
  assert.doesNotMatch(html, /<svg class="gold-bar"/);
});

test('all four characters ship all six timer states as web-ready PNGs', () => {
  for (const role of ROLES) {
    for (const state of STATES) {
      const rel = 'assets/cats/states/' + role + '/' + state + '@512.png';
      assert.ok(fs.existsSync(rel), rel + ' must exist');
      assert.ok(fs.statSync(rel).size > 1024, rel + ' must not be a placeholder');
    }
  }
  assert.ok(html.includes('assets/cats/states/' + ROLES[0] + '/idle@512.png'), 'page must preload the web-sized artwork');
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
  assert.equal(resolve({ mode: 'work' }, 100, 0, 0), 'work');
  assert.equal(resolve({ mode: 'work' }, 100, 200, 0), 'petted');
  assert.equal(resolve({ mode: 'unexpected' }, 100, 0, 0), 'idle');
});

test('artwork state mapping maps petted to interaction and unknown modes to idle', () => {
  const fn = html.match(/function mwResolveCatArtState\([^)]*\)\{[^}]*\}/);
  const states = html.match(/mwCatStates=\[[^\]]*\]/);
  assert.ok(fn && states, 'art state helpers must exist');
  const context = {};
  vm.runInNewContext(states[0] + ';' + fn[0] + '; result = mwResolveCatArtState;', context);
  const resolve = context.result;
  assert.equal(resolve('petted'), 'interaction');
  assert.equal(resolve('work'), 'work');
  assert.equal(resolve('paid'), 'paid');
  assert.equal(resolve('unpaid'), 'unpaid');
  assert.equal(resolve('off'), 'off');
  assert.equal(resolve('idle'), 'idle');
  assert.equal(resolve('unexpected'), 'idle');
});

test('artwork swapping runs on every draw and builds paths from the role map', () => {
  assert.match(html, /mwCatRoles=\['soft-bell','sport-headband','sleepy-nightcap','leader-crown'\]/);
  assert.match(html, /function mwCatArtPath\([^)]*\)\{return 'assets\/cats\/states\/'/);
  assert.ok(html.includes('mwApplyCatArt(catMode)'), 'draw() must swap the artwork when the mode changes');
});

test('preview page exposes six timer states plus four characters', () => {
  const preview = fs.readFileSync(PREVIEW, 'utf8');
  for (const mode of ['idle', 'work', 'paid', 'unpaid', 'off', 'petted']) {
    assert.ok(preview.includes('data-mode="' + mode + '"'), 'preview must offer ' + mode);
  }
  for (let i = 0; i < 4; i++) assert.ok(preview.includes('data-variant="' + i + '"'), 'preview must offer variant ' + i);
  assert.ok(preview.includes("assets/cats/states/'+ROLES[variant]"));
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
