'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'v5.5.html'), 'utf8');
test('animated cat retains the existing identity and accessible interaction target', () => {
  assert.match(html, /class="cat cat-idle" id="cat" role="button" tabindex="0"/);
  assert.match(html, /aria-label="摸摸小猫"/);
});
test('cat has distinct idle, work, paid break, unpaid break and pet animations', () => {
  for (const name of ['cat-idle', 'cat-work', 'cat-paid', 'cat-unpaid', 'cat-petted']) assert.ok(html.includes('.cat.' + name));
  for (const name of ['cat-idle', 'cat-carry', 'cat-purr', 'cat-sleep', 'cat-petted']) assert.ok(html.includes('@keyframes ' + name));
});
test('animation adapts to narrow phones and reduced-motion preference', () => {
  assert.ok(html.includes('@media(max-width:380px)'));
  assert.ok(html.includes('@media(prefers-reduced-motion:reduce)'));
});
test('petting works with pointer and keyboard and does not touch work-session storage', () => {
  assert.ok(html.includes("catEl.addEventListener('click',petCat)"));
  assert.ok(html.includes("catEl.addEventListener('keydown'"));
  const start = html.indexOf('function petCat()');
  const end = html.indexOf("catEl.addEventListener('click'", start);
  assert.ok(start >= 0 && end > start);
  const handler = html.slice(start, end);
  assert.doesNotMatch(handler, /localStorage|save\(|data\.session|drawRecords/);
});
