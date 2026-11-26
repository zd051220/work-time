'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {getReleaseKind,getCategory,renderEntries,updateChangelog}=require('./changelog.cjs');
const pr=(number,title,labels=['release:patch'],body='',merged_at='2026-11-26T01:00:00Z')=>({number,title,labels:labels.map(name=>({name})),body,merged_at});
test('uses explicit release labels and skips unlabelled or release:none PRs',()=>{
 const r=renderEntries([pr(1,'feat: add timer'),pr(2,'fix: bug',[]),pr(3,'chore: internal',['release:none'])],'owner/repo');
 assert.deepEqual(r.included,[1]);assert.equal(r.unlabeled,1);assert.match(r.markdown,/新功能/);
});
test('rejects conflicting release labels',()=>assert.throws(()=>getReleaseKind(pr(4,'feat: x',['release:patch','release:minor'])),/冲突/));
test('classifies conventional PR titles in Chinese',()=>{
 assert.equal(getCategory('feat(timer): add picker'),'新功能');
 assert.equal(getCategory('fix: repair save'),'问题修复');
 assert.equal(getCategory('perf: faster render'),'性能优化');
 assert.equal(getCategory('docs: update guide'),'文档更新');
 assert.equal(getCategory('chore: update deps'),'工程优化');
 assert.equal(getCategory('miscellaneous update'),'其他更新');
});
test('uses safe GitHub-generated PR links and a cleaned description',()=>{
 const r=renderEntries([pr(5,'feat: add <script>alert(1)</script>','release:minor'.split(),'<b>Useful</b> details\n\nMore')],'owner/repo');
 assert.match(r.markdown,/\[#5\]\(https:\/\/github\.com\/owner\/repo\/pull\/5\)/);
 assert.doesNotMatch(r.markdown,/<script>/);assert.match(r.markdown,/Useful details/);
 const injected=renderEntries([pr(6,'feat: [click](https://evil.example)','release:patch'.split())],'owner/repo').markdown;
 assert.doesNotMatch(injected,/evil\\.example/);
});
test('deduplicates PR numbers and orders newest first',()=>{
 const r=renderEntries([pr(7,'fix: older',undefined,'','2026-11-25T00:00:00Z'),pr(8,'fix: newer',undefined,'','2026-11-26T00:00:00Z'),pr(8,'fix: duplicate')],'owner/repo');
 assert.deepEqual(r.included,[8,7]);assert.equal((r.markdown.match(/\[#8\]/g)||[]).length,1);
});
test('ignores malformed and unmerged records',()=>{
 const r=renderEntries([{number:1,title:'feat: missing merged date',labels:[{name:'release:patch'}]},{number:'2',title:'fix: invalid number',labels:[{name:'release:patch'}],merged_at:'2026-11-26'}],'owner/repo');
 assert.deepEqual(r.included,[]);
});
test('updates only the generated block and is idempotent',()=>{
 const original='# 更新日志\n\n## [未发布]\n\n手工说明。\n\n## [5.5.0]\n\n历史内容。\n';
 const first=updateChangelog(original,[pr(10,'feat: new option')],'owner/repo').content;
 const second=updateChangelog(first,[pr(10,'feat: new option')],'owner/repo').content;
 assert.equal(first,second);assert.match(first,/手工说明/);assert.match(first,/历史内容/);assert.equal((first.match(/BEGIN AUTO-GENERATED/g)||[]).length,1);
});
test('replaces stale generated content without duplicating entries',()=>{
 const original='# 更新日志\n\n## [未发布]\n\n<!-- BEGIN AUTO-GENERATED PR CHANGELOG -->\nold\n<!-- END AUTO-GENERATED PR CHANGELOG -->\n\n## [5.5.0]\n';
 const updated=updateChangelog(original,[pr(11,'fix: corrected')],'owner/repo').content;
 assert.doesNotMatch(updated,/\nold\n/);assert.match(updated,/\[#11\]/);
});
test('rejects broken marker pairs and invalid repository names',()=>{
 assert.throws(()=>updateChangelog('# 更新日志\n\n## [未发布]\n\n<!-- BEGIN AUTO-GENERATED PR CHANGELOG -->','[]','owner/repo'),/标记/);
 assert.throws(()=>renderEntries([],'owner/../repo'),/仓库名称/);
});
