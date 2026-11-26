'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {getReleaseKind,getCategory,renderEntries,updateChangelog,fetchMergedPullRequests}=require('./changelog.cjs');
const pr=(number,title,labels=['release:patch'],body='',merged_at='2026-11-26T01:00:00Z')=>({number,title,labels:labels.map(name=>({name})),body,merged_at});
const base='# 更新日志\n\n## [未发布]\n\n手工说明。\n\n## [5.5.0]\n\n历史内容。\n';
function response(items,status=200){return {ok:status>=200&&status<300,status,json:async()=>items};}

test('uses explicit release labels and skips unlabelled or release:none PRs',()=>{
 const r=renderEntries([pr(1,'feat: add timer'),pr(2,'fix: bug',[]),pr(3,'chore: internal',['release:none'])],'owner/repo');
 assert.deepEqual(r.included,[1]);assert.equal(r.unlabeled,1);assert.match(r.markdown,/新功能/);
});
test('rejects conflicting release labels and malformed labels',()=>{
 assert.throws(()=>getReleaseKind(pr(4,'feat: x',['release:patch','release:minor'])),/冲突/);
 assert.throws(()=>getReleaseKind({number:5,labels:null}),/labels 必须是数组/);
});
test('classifies conventional PR titles in Chinese',()=>{
 assert.equal(getCategory('feat(timer): add picker'),'新功能');
 assert.equal(getCategory('fix: repair save'),'问题修复');
 assert.equal(getCategory('perf: faster render'),'性能优化');
 assert.equal(getCategory('security: harden auth'),'安全改进');
 assert.equal(getCategory('docs: update guide'),'文档更新');
 assert.equal(getCategory('chore: update deps'),'工程优化');
 assert.equal(getCategory('miscellaneous update'),'其他更新');
});
test('cleans untrusted title and description text and uses repository-generated links',()=>{
 const r=renderEntries([pr(5,'feat: add <script>alert(1)</script>','release:minor'.split(),'<b>Useful</b> details\n\nMore')],'owner/repo');
 assert.match(r.markdown,/\[#5\]\(https:\/\/github\.com\/owner\/repo\/pull\/5\)/);
 assert.doesNotMatch(r.markdown,/<script>|evil\.example/);assert.match(r.markdown,/Useful details/);
 const injected=renderEntries([pr(6,'feat: [click](https://evil.example)','release:patch'.split())],'owner/repo').markdown;
 assert.doesNotMatch(injected,/evil\.example/);
});
test('deduplicates PR numbers and orders newest first',()=>{
 const r=renderEntries([pr(7,'fix: older',undefined,'','2026-11-25T00:00:00Z'),pr(8,'fix: newer',undefined,'','2026-11-26T00:00:00Z'),pr(8,'fix: duplicate')],'owner/repo');
 assert.deepEqual(r.included,[8,7]);assert.equal((r.markdown.match(/\[#8\]/g)||[]).length,1);
});
test('ignores malformed and unmerged records but fails closed on malformed labels for otherwise valid PRs',()=>{
 const r=renderEntries([{number:1,title:'feat: missing merged date',labels:[{name:'release:patch'}]},{number:'2',title:'fix: invalid number',labels:[{name:'release:patch'}],merged_at:'2026-11-26'}],'owner/repo');
 assert.deepEqual(r.included,[]);
 assert.throws(()=>renderEntries([{number:3,title:'fix: valid shape',labels:null,merged_at:'2026-11-26T00:00:00Z'}],'owner/repo'),/labels 必须是数组/);
});
test('updates only the generated block, preserves manual text, and is idempotent',()=>{
 const first=updateChangelog(base,[pr(10,'feat: new option')],'owner/repo').content;
 const second=updateChangelog(first,[pr(10,'feat: new option')],'owner/repo').content;
 assert.equal(first,second);assert.ok(first.startsWith('# 更新日志\n\n## [未发布]\n\n手工说明。'));
 assert.ok(first.endsWith('## [5.5.0]\n\n历史内容。\n'));assert.equal((first.match(/BEGIN AUTO-GENERATED/g)||[]).length,1);
});
test('replaces stale generated content without duplicating entries',()=>{
 const original='# 更新日志\n\n## [未发布]\n\n<!-- BEGIN AUTO-GENERATED PR CHANGELOG -->\nold\n<!-- END AUTO-GENERATED PR CHANGELOG -->\n\n## [5.5.0]\n';
 const updated=updateChangelog(original,[pr(11,'fix: corrected')],'owner/repo').content;
 assert.doesNotMatch(updated,/\nold\n/);assert.match(updated,/\[#11\]/);
});
test('rejects missing, duplicate, unmatched, and reversed generated markers',()=>{
 const heading='# 更新日志\n\n## [未发布]\n\n';
 assert.throws(()=>updateChangelog(heading+'<!-- BEGIN AUTO-GENERATED PR CHANGELOG -->','[]','owner/repo'),/标记/);
 assert.throws(()=>updateChangelog(heading+'<!-- END AUTO-GENERATED PR CHANGELOG -->','[]','owner/repo'),/标记/);
 assert.throws(()=>updateChangelog(heading+'<!-- END AUTO-GENERATED PR CHANGELOG -->\n<!-- BEGIN AUTO-GENERATED PR CHANGELOG -->','[]','owner/repo'),/顺序/);
 assert.throws(()=>updateChangelog(heading+'<!-- BEGIN AUTO-GENERATED PR CHANGELOG -->\na\n<!-- END AUTO-GENERATED PR CHANGELOG -->\n<!-- END AUTO-GENERATED PR CHANGELOG -->','[]','owner/repo'),/重复/);
 assert.throws(()=>renderEntries([],'owner/../repo'),/仓库名称/);
});
test('fetches all pages and accepts exactly 2000 records when page 21 is empty',async()=>{
 let calls=0;
 const fetchImpl=async url=>{calls++;const u=new URL(url);const page=Number(u.searchParams.get('page'));return response(page<=20?Array.from({length:100},(_,i)=>({number:(page-1)*100+i+1,merged_at:'2026-11-26'})):[]);};
 const result=await fetchMergedPullRequests('owner/repo','token',fetchImpl);
 assert.equal(result.length,2000);assert.equal(calls,21);
});
test('fails closed when more than 2000 PRs exist and never silently truncates',async()=>{
 let calls=0;
 const fetchImpl=async url=>{calls++;const page=Number(new URL(url).searchParams.get('page'));return response(page<=20?Array.from({length:100},(_,i)=>({number:(page-1)*100+i+1,merged_at:'2026-11-26'})):[{number:2001,merged_at:'2026-11-26'}]);};
 await assert.rejects(()=>fetchMergedPullRequests('owner/repo','token',fetchImpl),/超过安全分页上限/);
 assert.equal(calls,21);
});
test('rejects HTTP errors, malformed API payloads, and invalid fetch arguments',async()=>{
 await assert.rejects(()=>fetchMergedPullRequests('owner/repo','token',async()=>response([],403)),/HTTP 403/);
 await assert.rejects(()=>fetchMergedPullRequests('owner/repo','token',async()=>response({items:[]})),/返回格式无效/);
 await assert.rejects(()=>fetchMergedPullRequests('../repo','token',async()=>response([])),/仓库名称无效/);
 await assert.rejects(()=>fetchMergedPullRequests('owner/repo','',async()=>response([])),/缺少 GitHub API token/);
});

const { generateIsolatedChangelog, OUTPUT } = require('./changelog-e2e-test.cjs');
test('isolated end-to-end fixture includes release:patch and skips unlabelled PR without touching formal changelog',()=>{
 const generated=generateIsolatedChangelog();
 assert.equal(OUTPUT,'docs/release/e2e-test/CHANGELOG.test.md');
 assert.match(generated,/\[#910001\]/);
 assert.doesNotMatch(generated,/\[#910002\]/);
 assert.match(generated,/TEST ONLY/);
 assert.match(generated,/测试文件人工说明：此段必须保留。/);
 assert.match(generated,/历史测试内容必须保留。/);
});
