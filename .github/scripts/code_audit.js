#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
const targets = files.length ? files : [
  'index.html',
  'v5.5.html',
  'ledger-v5.5.html',
  'beta-v5.5.html',
  'cat-workshop.html'
];
let failures = 0;
function fail(file, message) {
  failures++;
  console.error('FAIL ' + file + ': ' + message);
}
function section(source, start, end) {
  const a = source.indexOf(start);
  if (a < 0) return '';
  const b = source.indexOf(end, a + start.length);
  return source.slice(a, b < 0 ? source.length : b);
}

for (const file of targets) {
  const source = fs.readFileSync(file, 'utf8');
  const ids = [...source.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
  const duplicates = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (duplicates.length) fail(file, 'duplicate id: ' + duplicates.join(', '));

  const refs = [
    ...[...source.matchAll(/\$\(\s*["']([^"']+)["']\s*\)/g)].map(m => m[1]),
    ...[...source.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)].map(m => m[1])
  ];
  const missing = [...new Set(refs.filter(id => !ids.includes(id)))];
  if (missing.length) fail(file, 'missing static DOM id: ' + missing.join(', '));

  const scripts = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  scripts.forEach((script, i) => {
    try { new Function(script); }
    catch (error) { fail(file, 'inline script ' + (i + 1) + ' syntax: ' + error.message); }
  });

  // "service_role" can legitimately appear in explanatory comments; only flag a secret-key value prefix.
  if (/\.html$/i.test(file) && /sb_secret_[A-Za-z0-9_-]{20,}/i.test(source)) {
    fail(file, 'possible Supabase secret key in browser HTML');
  }
}

const production = fs.readFileSync('v5.5.html', 'utf8');
const pull = section(production, 'function accPull(){', 'function syncAll(first){');
const sync = section(production, 'function syncAll(first){', "if($('accLogin')){");
const tombPull = section(production, 'function tombPull(){', 'function accRow(');
const deleteRecord = section(production, 'function accDelRec(id){', 'function accPull(){');
if (!/return\s+tombPull\(\)\.then/.test(pull)) fail('v5.5.html', 'cloud pull must wait for deletion markers');
if (!/if\(!r\.ok\)throw/.test(tombPull)) fail('v5.5.html', 'tombstone pull must fail closed on HTTP errors');
if (!/return\s+tombPush\(\)\.then/.test(sync)) fail('v5.5.html', 'cloud sync must await deletion-marker upload');
if (!/return\s+tombPush\(\)\.then/.test(deleteRecord)) fail('v5.5.html', 'record deletion must await deletion-marker upload');
if (/\btombPush\(\)\s*;/.test(sync)) fail('v5.5.html', 'fire-and-forget tombstone upload remains in syncAll');

if (failures) {
  console.error('\nCode audit failed: ' + failures + ' issue(s)');
  process.exit(1);
}
console.log('Code audit passed: ' + targets.length + ' file(s), DOM IDs, inline JS syntax, and cloud deletion ordering.');
