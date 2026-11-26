'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {makeReleaseSection,insertReleaseSection,prepare} = require('./release-automation.cjs');

const releaseWorkflow = fs.readFileSync(path.join(__dirname,'../workflows/automatic-formal-release.yml'),'utf8');
// Keep the verified release-notes path connected from the validation step output to artifact upload.
assert.match(releaseWorkflow,/NOTES="\\$RUNNER_TEMP\\/release-notes\\.md"/);
assert.match(releaseWorkflow,/echo "notes=\\$NOTES" >> "\\$GITHUB_OUTPUT"/);
assert.match(releaseWorkflow,/path:\\s*\\$\\{\\{\\s*steps\\.release\\.outputs\\.notes\\s*\\}\\}/);

const section = makeReleaseSection({
  version:'5.6.0',date:'2026-11-27',title:'feat: add farming',
  number:42,repository:'zd051220/work-time',body:'Add crops and seasons.'
});
assert.match(section,/## \[5\.6\.0\] - 2026-11-27/);
assert.match(section,/\[#42\]/);
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
