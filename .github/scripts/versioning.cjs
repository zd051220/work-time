#!/usr/bin/env node
'use strict';
const fs = require('node:fs');

const versioningCore = require('../../js/versioning-core.js');
const { parseSemVer, parseRuntimeVersion, compareSemVer, validateVersionConfig } = versioningCore;
const RELEASE_LABELS = new Set(['release:major', 'release:minor', 'release:patch', 'release:none']);

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
  if(bump==='major'){major=versioningCore.incrementDecimalString(major);minor='0';patch='0';}
  else if(bump==='minor'){minor=versioningCore.incrementDecimalString(minor);patch='0';}
  else if(bump==='patch')patch=versioningCore.incrementDecimalString(patch);
  else throw new Error('不支持的版本递增类型：'+bump);
  return major+'.'+minor+'.'+patch;
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
