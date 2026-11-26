#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const START = '<!-- BEGIN AUTO-GENERATED PR CHANGELOG -->';
const END = '<!-- END AUTO-GENERATED PR CHANGELOG -->';
const RELEASE_LABELS = new Set(['release:major','release:minor','release:patch','release:none']);
const CATEGORY_RULES = [
  [/^(feat|feature)(\(.+\))?:/i,'新功能'],[/^(fix|bugfix)(\(.+\))?:/i,'问题修复'],
  [/^(perf)(\(.+\))?:/i,'性能优化'],[/^(security|sec)(\(.+\))?:/i,'安全改进'],
  [/^(docs?)(\(.+\))?:/i,'文档更新'],[/^(refactor|test|ci|build|chore)(\(.+\))?:/i,'工程优化']
];
function cleanText(value,limit=180){
  if(typeof value!=='string')return '';
  return value.replace(/<[^>]*>/g,' ').replace(/!\[[^\]]*\]\([^)]*\)/g,' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[\x60*_>#~]/g,' ')
    .replace(/https?:\/\/\S+/g,'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,limit);
}
function getReleaseKind(pr){
  if(!Array.isArray(pr.labels))throw new Error('PR #'+pr.number+' 的 labels 必须是数组');
  const names=pr.labels.map(x=>typeof x==='string'?x:x&&x.name).filter(Boolean);
  const selected=names.filter(x=>RELEASE_LABELS.has(x));
  if(selected.length>1)throw new Error('PR #'+pr.number+' 存在冲突版本标签：'+selected.join(', '));
  if(!selected.length)return 'unlabeled';
  return selected[0].slice('release:'.length);
}
function getCategory(title){
  for(const [pattern,category] of CATEGORY_RULES)if(pattern.test(title))return category;
  return '其他更新';
}
function getSummary(body){
  if(typeof body!=='string')return '';
  const paragraph=body.split(/\n\s*\n/).map(value => cleanText(value)).find(Boolean);
  return paragraph?paragraph.slice(0,180):'';
}
function renderEntries(pulls,repository){
  if(!Array.isArray(pulls))throw new TypeError('PR 数据必须是数组');
  if(typeof repository!=='string'||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))throw new Error('仓库名称无效');
  const unique=new Map();let unlabeled=0;
  for(const pr of pulls){
    if(!pr||!Number.isSafeInteger(pr.number)||pr.number<1||typeof pr.title!=='string'||!pr.title.trim()||
      typeof pr.merged_at!=='string'||!Number.isFinite(Date.parse(pr.merged_at)))continue;
    const kind=getReleaseKind(pr);
    if(kind==='unlabeled'){unlabeled++;continue;}
    if(kind==='none')continue;
    if(!unique.has(pr.number))unique.set(pr.number,{pr,kind});
  }
  const groups=new Map();
  for(const {pr,kind} of [...unique.values()].sort((a,b)=>Date.parse(b.pr.merged_at)-Date.parse(a.pr.merged_at)||b.pr.number-a.pr.number)){
    const category=getCategory(pr.title);
    if(!groups.has(category))groups.set(category,[]);
    const title=cleanText(pr.title,120),summary=getSummary(pr.body);
    const line='- '+title+(summary&&summary.toLowerCase()!==title.toLowerCase()?' — '+summary:'')+
      ' ([#'+pr.number+'](https://github.com/'+repository+'/pull/'+pr.number+'))';
    groups.get(category).push({line,number:pr.number,kind});
  }
  const order=['新功能','问题修复','性能优化','安全改进','其他更新','工程优化','文档更新'];
  const sections=[];
  for(const category of order){const entries=groups.get(category);if(entries&&entries.length)sections.push('### '+category+'\n'+entries.map(x=>x.line).join('\n'));}
  return {markdown:sections.length?sections.join('\n\n'):'（暂无带有效版本标签的已合并 PR）',included:[...unique.keys()],unlabeled};
}
function updateChangelog(existing,pulls,repository){
  if(typeof existing!=='string'||!existing.includes('## [未发布]'))throw new Error('CHANGELOG.md 缺少「## [未发布]」章节');
  const sc=existing.split(START).length-1,ec=existing.split(END).length-1;
  if(sc!==ec||sc>1)throw new Error('CHANGELOG 自动生成标记不完整或重复');
  const generated=renderEntries(pulls,repository),block=START+'\n'+generated.markdown+'\n'+END;
  let output;
  if(sc===1){
    const a=existing.indexOf(START),b=existing.indexOf(END,a)+END.length;
    output=existing.slice(0,a)+block+existing.slice(b);
  }else{
    const next=existing.indexOf('\n## ',existing.indexOf('## [未发布]')+1);
    if(next<0)output=existing.trimEnd()+'\n\n'+block+'\n';
    else output=existing.slice(0,next).trimEnd()+'\n\n'+block+'\n'+existing.slice(next).replace(/^\n+/,'\n');
  }
  return {content:output,included:generated.included,unlabeled:generated.unlabeled};
}
async function fetchMergedPullRequests(repository,token){
  const all=[];
  for(let page=1;page<=20;page++){
    const url='https://api.github.com/repos/'+repository+'/pulls?state=closed&sort=updated&direction=desc&per_page=100&page='+page;
    const response=await fetch(url,{headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28'}});
    if(!response.ok)throw new Error('读取 GitHub PR 列表失败：HTTP '+response.status);
    const items=await response.json();
    if(!Array.isArray(items))throw new Error('GitHub PR API 返回格式无效');
    all.push(...items.filter(pr=>pr&&pr.merged_at));
    if(items.length<100)return all;
  }
  throw new Error('PR 数量超过安全分页上限，请人工检查后再运行');
}
async function main(){
  const repository=process.env.GITHUB_REPOSITORY,token=process.env.GITHUB_TOKEN,file=process.argv[2]||'CHANGELOG.md';
  if(!repository||!token)throw new Error('必须提供 GITHUB_REPOSITORY 和 GITHUB_TOKEN');
  const pulls=await fetchMergedPullRequests(repository,token),existing=fs.readFileSync(file,'utf8');
  const result=updateChangelog(existing,pulls,repository);
  if(result.content!==existing)fs.writeFileSync(file,result.content);
  console.log('CHANGELOG 已更新；纳入 '+result.included.length+' 个 PR；无版本标签而跳过 '+result.unlabeled+' 个 PR。');
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={cleanText,getReleaseKind,getCategory,renderEntries,updateChangelog};
