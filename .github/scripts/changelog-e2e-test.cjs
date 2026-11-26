'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { updateChangelog } = require('./changelog.cjs');

const OUTPUT = 'docs/release/e2e-test/CHANGELOG.test.md';
const REPOSITORY = 'zd051220/work-time';
const FIXTURES = [
  {
    number: 910001,
    title: 'feat(timer): add isolated test timer',
    body: '验证带 release:patch 标签的 PR 会进入测试更新日志。',
    labels: [{ name: 'release:patch' }],
    merged_at: '2026-11-26T02:00:00Z'
  },
  {
    number: 910002,
    title: 'fix: this unlabelled PR must be skipped',
    body: '验证没有版本标签的 PR 不会进入更新日志。',
    labels: [],
    merged_at: '2026-11-26T02:01:00Z'
  }
];
const TEMPLATE = [
  '# 自动更新日志端到端测试（隔离文件）',
  '',
  '> TEST ONLY：本文件为自动化测试产物，不属于正式 CHANGELOG。',
  '',
  '## [未发布]',
  '',
  '测试文件人工说明：此段必须保留。',
  '',
  '## [历史测试章节]',
  '',
  '历史测试内容必须保留。',
  ''
].join('\n');

function generateIsolatedChangelog() {
  const result = updateChangelog(TEMPLATE, FIXTURES, REPOSITORY);
  assert.deepEqual(result.included, [910001], '仅带 release:patch 的模拟 PR 应被纳入');
  assert.equal(result.unlabeled, 1, '无标签模拟 PR 应被计为跳过');
  assert.match(result.content, /\[#910001\]/, '应生成带标签 PR 的链接');
  assert.doesNotMatch(result.content, /\[#910002\]/, '无标签 PR 不得进入更新日志');
  assert.match(result.content, /测试文件人工说明：此段必须保留。/);
  assert.match(result.content, /历史测试内容必须保留。/);
  assert.match(result.content, /TEST ONLY/);
  assert.doesNotMatch(result.content, /(^|\n)## \[5\.5\.0\]/);
  return result.content;
}

if (require.main === module) {
  const target = process.argv[2] || OUTPUT;
  if (target !== OUTPUT) throw new Error('测试模式只允许写入 ' + OUTPUT);
  const content = generateIsolatedChangelog();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
  console.log('隔离 CHANGELOG 测试通过；纳入 1 个 release:patch PR；跳过 1 个无标签 PR。');
  console.log('输出：' + OUTPUT);
}
module.exports = { generateIsolatedChangelog, OUTPUT };
