'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {makeReleaseSection,extractReleaseSummary,insertReleaseSection,prepare} = require('./release-automation.cjs');

const section = makeReleaseSection({
  version:'5.6.0',date:'2026-11-27',title:'feat: add farming',
  number:42,repository:'zd051220/work-time',body:'Add crops and seasons.'
});
assert.match(section,/## \[5\.6\.0\] - 2026-11-27/);
assert.match(section,/\[#42\]/);

const structuredBody = [
  '## 测试目的',
  '',
  '验证普通 PR 合并到 main 后，唯一 release:patch 标签能否触发自动版本候选分支与候选 PR 创建。',
  '',
  '## 变更范围',
  '',
  '仅新增自动化验收文档，不改产品代码、版本文件或 CHANGELOG。',
  '',
  '## 安全边界',
  '',
  '不创建 Tag/Release；不触发正式发布。'
].join('\n');
const structuredSection = makeReleaseSection({
  version:'5.6.1',date:'2026-11-27',title:'test: verify release trigger',
  number:44,repository:'zd051220/work-time',body:structuredBody
});
assert.match(structuredSection,/验证普通 PR 合并到 main 后/);
assert.doesNotMatch(structuredSection,/变更范围|安全边界|不改产品代码|不创建 Tag/);
assert.equal(extractReleaseSummary('## 概述\n\n<!-- hidden template -->\n\n'), '');
const titleOnlySection = makeReleaseSection({
  version:'5.6.2',date:'2026-11-27',title:'fix: concise title',
  number:45,repository:'zd051220/work-time',body:'## 概述\n\n<!-- no useful text -->'
});
assert.match(titleOnlySection,/^- fix: concise title \(\[#45\]/m);

// Empty first section must not borrow prose from a later section.
assert.equal(extractReleaseSummary('## 摘要\n\n## 变更范围\n\n不应被当作摘要。'), '');
assert.equal(extractReleaseSummary('## 摘要\r\n\r\n## 变更范围\r\n\r\n不应被当作摘要。'), '');
// Setext headings are headings too; an empty first section remains empty.
assert.equal(extractReleaseSummary('摘要\n---\n\n变更范围\n---\n\n不应被当作摘要。'), '');
assert.equal(extractReleaseSummary('摘要\n---\n\n第一段说明。\n\n后续段落。'), '第一段说明。');
// Consecutive blockquote lines are excluded rather than flattened into the summary.
assert.equal(extractReleaseSummary('## 摘要\n\n> 引用一\n> 引用二\n\n真正的说明。'), '');
assert.equal(extractReleaseSummary('## 摘要\n\n> 引用一\n> 引用二\n普通说明。'), '');
// CRLF and bare CR line endings normalize consistently.
assert.equal(extractReleaseSummary('## 摘要\r\n\r\n第一行\r\n第二行'), '第一行 第二行');
assert.equal(extractReleaseSummary('## 摘要\r\r第一行\r第二行'), '第一行 第二行');
// Long summaries are capped at 180 characters.
assert.equal(extractReleaseSummary('a'.repeat(220)).length, 180);
// Markdown images are removed and links retain their readable labels.
assert.equal(extractReleaseSummary('查看 ![示意图](https://example.com/a.png) [使用说明](https://example.com/docs)。'), '查看 使用说明。');
// Lists are rendered as readable text without leading bullet/number markers.
assert.equal(extractReleaseSummary('## 摘要\n\n- 第一项\n- 第二项\n3. 第三项'), '第一项 第二项 第三项');
// Adjacent lines form one paragraph; a blank line ends it.
assert.equal(extractReleaseSummary('## 摘要\n\n第一行\n第二行\n\n第二段不纳入。'), '第一行 第二行');
// HTML comments, including multiline comments, cannot leak into the summary.
assert.equal(extractReleaseSummary('## 摘要\n\n第一段 <!-- hidden --> 继续。\n<!--\nsecret\n-->'), '第一段 继续。');
assert.equal(extractReleaseSummary('<!-- opening -->\n## 摘要\n\n可见说明。<!-- hidden -->'), '可见说明。');

const source='# 更新日志\n\n## [未发布]\n\n暂无\n\n## [5.5.0] - baseline\n\n历史内容\n';
const output=insertReleaseSection(source,section);
assert.ok(output.indexOf('## [5.6.0]') < output.indexOf('## [5.5.0]'));
assert.match(output,/## \[未发布\]/);
assert.throws(()=>insertReleaseSection(output,section),/已存在/);
assert.throws(()=>makeReleaseSection({version:'5.6.0-rc.1',date:'2026-11-27',title:'x',number:1,repository:'a/b',body:''}),/稳定版/);

const root=fs.mkdtempSync(path.join(os.tmpdir(),'release-auto-'));
try {
  fs.writeFileSync(path.join(root,'version.json'),JSON.stringify({version:'5.5',url:'v5.5.html',note:'baseline'}));
  fs.writeFileSync(path.join(root,'CHANGELOG.md'),source);
  const result=prepare({root,bump:'patch',title:'fix: sample',body:'Repair a bug.',number:43,repository:'zd051220/work-time',date:'2026-11-27'});
  assert.equal(result.next,'5.5.1');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'version.json'),'utf8')).version,'5.5.1');
  assert.match(fs.readFileSync(path.join(root,'CHANGELOG.md'),'utf8'),/## \[5\.5\.1\]/);
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}
console.log('release automation tests passed');
