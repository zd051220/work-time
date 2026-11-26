'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'v5.5.html'), 'utf8');
test('2D kitten uses a drawn SVG character rather than an emoji placeholder', () => {
  assert.match(html, /<svg class="cat-art" viewBox="0 0 160 120"/);
  for (const id of ['catTail','catBody','catHead','catLegs','goldProp','sleepMarks','happyMarks']) assert.ok(html.includes('id="'+id+'"'));
  assert.doesNotMatch(html, /id="cat"[^>]*>🐈/);
});
test('kitten has idle, walk, carry, happy, sleep and pet animation states', () => {
  for (const name of ['cat-idle','cat-walk','cat-work','cat-paid','cat-unpaid','cat-petted']) assert.ok(html.includes('.'+name));
  for (const name of ['kitten-idle','kitten-tail','kitten-carry','kitten-gold','kitten-happy','kitten-sleep','kitten-pet','kitten-walk','kitten-leg']) assert.ok(html.includes('@keyframes '+name));
});
test('kitten remains touch and keyboard accessible and fits narrow phones', () => {
  assert.match(html, /id="cat" role="button" tabindex="0" aria-label="摸摸小猫"/);
  assert.ok(html.includes('@media(max-width:380px)'));
  assert.ok(html.includes('@media(prefers-reduced-motion:reduce)'));
  assert.ok(html.includes("catEl.addEventListener('click',petCat)"));
  assert.ok(html.includes("catEl.addEventListener('keydown'"));
});
test('petting handler does not access work-session storage or accounting', () => {
  const start = html.indexOf('function petCat()');
  const end = html.indexOf("catEl.addEventListener('click'", start);
  assert.ok(start >= 0 && end > start);
  const handler = html.slice(start, end);
  assert.doesNotMatch(handler, /localStorage|save\(|data\.session|drawRecords/);
});
