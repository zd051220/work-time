'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../../js/versioning-core.js'), 'utf8');

test('shared core exposes its API without BigInt in a browser-like global context', () => {
  const context = vm.createContext({BigInt:undefined});
  vm.runInContext(source, context, {filename:'versioning-core.js'});
  assert.equal(typeof context.VersioningCore.parseRuntimeVersion, 'function');
  assert.equal(context.VersioningCore.compareSemVer('5.6.0-rc.1', '5.6.0'), -1);
  assert.equal(context.VersioningCore.compareSemVer('5.6.0-beta.2', '5.6.0-beta.11'), -1);
  assert.equal(context.VersioningCore.compareSemVer('999999999999999999999.0.0', '1000000000000000000000.0.0'), -1);
  assert.equal(context.VersioningCore.compareSemVer('1.0.0-999999999999999999999', '1.0.0-1000000000000000000000'), -1);
  assert.equal(context.VersioningCore.incrementDecimalString('999999999999999999999'), '1000000000000000000000');
  assert.equal(context.BigInt, undefined);
});
test('CommonJS and browser globals return identical comparison results', () => {
  const context = vm.createContext({BigInt:undefined});
  vm.runInContext(source, context);
  const browser = context.VersioningCore;
  const node = require('../../js/versioning-core.js');
  const pairs = [
    ['5.5','5.5.0'], ['5.6.0-alpha','5.6.0-beta'],
    ['5.6.0-beta.2','5.6.0-beta.11'], ['5.6.0-rc.1','5.6.0'],
    ['5.6.0+one','5.6.0+two'],
    ['999999999999999999999.0.0','1000000000000000000000.0.0']
  ];
  for (const [a,b] of pairs) assert.equal(browser.compareSemVer(a,b),node.compareSemVer(a,b));
  assert.equal(context.BigInt, undefined);
});
test('shared core source does not depend on BigInt syntax or runtime globals', () => {
  assert.doesNotMatch(source, /\bBigInt\b|[0-9]n\b/);
});
test('shared config validation rejects invalid versions and unsafe URLs', () => {
  const core = require('../../js/versioning-core.js');
  assert.equal(core.validateVersionConfig({version:'5.6.0',url:'v5.6.0.html',note:''}).valid,true);
  for (const version of ['5.6.abc','05.6.0','5.6.0-01']) {
    assert.equal(core.validateVersionConfig({version,url:'v5.6.0.html',note:''}).valid,false);
  }
  for (const url of ['/v5.6.0.html','../v5.6.0.html','https://example.com/v5.6.0.html','folder\\v5.6.0.html']) {
    assert.equal(core.validateVersionConfig({version:'5.6.0',url,note:''}).valid,false);
  }
});
