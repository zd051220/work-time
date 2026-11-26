#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const versioning = require('./versioning.cjs');
const { cleanMarkdownText, extractSummary } = require('./md-summary.cjs');

function cleanMarkdown(value, limit=180) { return cleanMarkdownText(value, limit); }

function makeReleaseSection({version, date, title, number, repository, body}) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('仅允许稳定版 SemVer');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('发布日期格式无效');
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('PR 编号无效');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('仓库名称无效');
  const safeTitle = cleanMarkdown(title, 140);
  if (!safeTitle) throw new Error('PR 标题为空');
  const summary = extractSummary(body, title, 180);
  const line = '- ' + safeTitle + (summary && summary.toLowerCase() !== safeTitle.toLowerCase() ? ' — ' + summary : '') +
    ' ([#' + number + '](https://github.com/' + repository + '/pull/' + number + '))';
  return '## [' + version + '] - ' + date + '\n\n### 更新内容\n' + line + '\n';
}

function insertReleaseSection(changelog, section) {
  if (typeof changelog !== 'string' || !/^## \[未发布\]/m.test(changelog)) throw new Error('CHANGELOG 缺少未发布章节');
  const match = /^## \[未发布\][\s\S]*?(?=^## \[|\s*$)/m.exec(changelog);
  if (!match) throw new Error('无法定位未发布章节');
  const nextHeading = changelog.indexOf('\n## [', match.index + match[0].length - 1);
  if (nextHeading < 0) throw new Error('CHANGELOG 缺少历史版本章节');
  if (new RegExp('^## \\[' + section.match(/^## \[([^\]]+)\]/)[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]', 'm').test(changelog)) {
    throw new Error('该版本的 CHANGELOG 章节已存在');
  }
  return changelog.slice(0, nextHeading + 1) + section + '\n' + changelog.slice(nextHeading + 1);
}

function prepare({root=process.cwd(), bump, title, body, number, repository, date}) {
  const versionFile = path.join(root, 'version.json');
  const changelogFile = path.join(root, 'CHANGELOG.md');
  const config = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
  const current = versioning.parseRuntimeVersion(config.version);
  if (current.prerelease.length) throw new Error('当前版本是预发布版本，拒绝自动递增');
  const next = versioning.calculateNextVersion(config.version, ['release:' + bump]);
  if (!next) throw new Error('无法计算下一版本');
  const section = makeReleaseSection({version:next,date,title,number,repository,body});
  const updatedChangelog = insertReleaseSection(fs.readFileSync(changelogFile, 'utf8'), section);
  const updatedConfig = {...config, version:next, note:'自动生成的正式发布候选版本'};
  fs.writeFileSync(changelogFile, updatedChangelog);
  fs.writeFileSync(versionFile, JSON.stringify(updatedConfig, null, 2) + '\n');
  return {current:config.version,next,section};
}

if (require.main === module) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command !== 'prepare') throw new Error('用法：release-automation.cjs prepare <bump> <title> <body> <pr-number> <repository> <date>');
    const [bump,title,body,number,repository,date] = args;
    if (!['patch','minor','major'].includes(bump)) throw new Error('版本标签无效');
    const result = prepare({bump,title,body,number:Number(number),repository,date});
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {cleanMarkdown,makeReleaseSection,insertReleaseSection,prepare};
