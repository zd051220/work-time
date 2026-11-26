#!/usr/bin/env node
'use strict';
const fs = require('node:fs');

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const LEGACY_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RELEASE_LABELS = new Set(['release:major', 'release:minor', 'release:patch', 'release:none']);

function parseSemVer(input) {
  if (typeof input !== 'string') throw new TypeError('版本号必须是字符串');
  const m = SEMVER_RE.exec(input);
  if (!m) throw new Error('无效的 SemVer 版本号：' + input);
  return { major:BigInt(m[1]), minor:BigInt(m[2]), patch:BigInt(m[3]),
    prerelease:m[4] ? m[4].split('.') : [], build:m[5] ? m[5].split('.') : [], raw:input };
}
function parseRuntimeVersion(input) {
  if (typeof input !== 'string') throw new TypeError('运行时版本号必须是字符串');
  if (LEGACY_RE.test(input)) return { ...parseSemVer(input + '.0'), legacy:true, sourceVersion:input };
  return { ...parseSemVer(input), legacy:false, sourceVersion:input };
}
function compareIdentifiers(a,b) {
  const an=/^\d+$/.test(a), bn=/^\d+$/.test(b);
  if(an&&bn){const x=BigInt(a),y=BigInt(b);return x<y?-1:x>y?1:0;}
  if(an!==bn)return an?-1:1;
  return a<b?-1:a>b?1:0;
}
function compareSemVer(left,right) {
  const a=typeof left==='string'?parseRuntimeVersion(left):left;
  const b=typeof right==='string'?parseRuntimeVersion(right):right;
  for(const k of ['major','minor','patch'])if(a[k]!==b[k])return a[k]<b[k]?-1:1;
  const ap=a.prerelease||[],bp=b.prerelease||[];
  if(!ap.length&&!bp.length)return 0;
  if(!ap.length)return 1;if(!bp.length)return -1;
  for(let i=0;i<Math.max(ap.length,bp.length);i++){
    if(i>=ap.length)return -1;if(i>=bp.length)return 1;
    const c=compareIdentifiers(ap[i],bp[i]);if(c)return c;
  }
  return 0;
}
function getReleaseBump(labels) {
  if(!Array.isArray(labels))throw new TypeError('PR 标签必须是数组');
  const names=labels.map(x=>typeof x==='string'?x:x&&x.name).filter(Boolean);
  const selected=names.filter(x=>RELEASE_LABELS.has(x));
  if(selected.length>1)throw new Error('PR 只能设置一个版本标签，当前检测到：'+selected.join(', '));
  if(!selected.length||selected[0]==='release:none')return null;
  return selected[0].slice('release:'.length);
}
function calculateNextVersion(currentVersion,labels) {
  const bump=getReleaseBump(labels);if(!bump)return null;
  const v=parseRuntimeVersion(currentVersion);
  if(v.prerelease.length)throw new Error('自动递增暂不接受预发布基线；请先完成正式版本发布或人工确定候选版本');
  let {major,minor,patch}=v;
  if(bump==='major'){major+=1n;minor=0n;patch=0n;}
  else if(bump==='minor'){minor+=1n;patch=0n;}
  else if(bump==='patch')patch+=1n;
  else throw new Error('不支持的版本递增类型：'+bump);
  return major.toString()+'.'+minor.toString()+'.'+patch.toString();
}
function validateVersionConfig(config) {
  const errors=[];
  if(!config||typeof config!=='object'||Array.isArray(config))return {valid:false,errors:['version.json 必须是 JSON 对象']};
  let parsed;
  try{parsed=parseRuntimeVersion(config.version);}catch(e){errors.push(e.message);}
  if(typeof config.url!=='string'||!config.url.trim())errors.push('url 必须是非空相对路径字符串');
  else{
    if(config.url!==config.url.trim())errors.push('url 不能包含首尾空白字符');
    const url=config.url;
    if(url.startsWith('/')||url.includes('\\')||url.includes('?')||url.includes('#')||
      /^[A-Za-z][A-Za-z0-9+.-]*:/.test(url)||url.split('/').some(p=>p==='..'||p==='.'||!p))
      errors.push('url 必须是站点内安全相对路径，不能包含协议、根路径、路径穿越或空路径段');
    if(!/^[A-Za-z0-9._/-]+$/.test(url))errors.push('url 只能包含字母、数字、点、下划线、斜杠和连字符');
    if(!url.toLowerCase().endsWith('.html'))errors.push('url 必须指向 .html 页面');
  }
  if(typeof config.note!=='string'||config.note.length>500)errors.push('note 必须是字符串，且不超过 500 个字符');
  return {valid:errors.length===0,errors,
    normalizedVersion:parsed?(parsed.major.toString()+'.'+parsed.minor.toString()+'.'+parsed.patch.toString()+(parsed.prerelease.length?'-'+parsed.prerelease.join('.') :'')):null,
    legacyVersion:Boolean(parsed&&parsed.legacy)};
}
function validateVersionConfigFile(file='version.json') {
  return validateVersionConfig(JSON.parse(fs.readFileSync(file,'utf8')));
}
if(require.main===module){
  const [cmd,...args]=process.argv.slice(2);
  try{
    if(cmd==='check-config'){
      const r=validateVersionConfigFile(args[0]||'version.json');
      if(!r.valid){console.error(r.errors.join('\n'));process.exitCode=1;}
      else console.log('version.json 有效：'+r.normalizedVersion+(r.legacyVersion?'（兼容旧版格式）':''));
    }else if(cmd==='next'){
      const [current,...labels]=args;if(!current)throw new Error('用法：node versioning.cjs next <当前版本> <PR 标签...>');
      console.log(calculateNextVersion(current,labels)||'不发布版本（缺少版本标签或标记为 release:none）');
    }else{console.error('用法：node versioning.cjs <check-config [version.json] | next <版本> <PR标签...>>');process.exitCode=2;}
  }catch(e){console.error(e.message);process.exitCode=1;}
}
module.exports={parseSemVer,parseRuntimeVersion,compareSemVer,getReleaseBump,calculateNextVersion,validateVersionConfig,validateVersionConfigFile};
