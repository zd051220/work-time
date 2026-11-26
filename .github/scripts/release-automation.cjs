#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const versioning = require('./versioning.cjs');

function cleanMarkdown(value, limit=180) {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[\x60*_>#~]/g, ' ')
    .replace(/[\[\]()|\\]/g, ' ')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, limit);
}

// Release notes should use one concise summary, not flatten every PR template section.
function extractReleaseSummary(body) {
  if (typeof body !== 'string' || !body.trim()) return '';
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const paragraph = [];
  let sectionLevel = null;
  let fenceChar = null;
  let fenceLength = 0;
  let inHtmlComment = false;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];

    // Ignore fenced code blocks; closing fence must match marker and length.
    if (fenceChar) {
      const closePattern = new RegExp('^ {0,3}' + fenceChar + '{' + fenceLength + ',}\\s*$');
      if (closePattern.test(rawLine)) {
        fenceChar = null;
        fenceLength = 0;
      }
      continue;
    }
    const fenceOpen = /^ {0,3}(\x60{3,}|~{3,})/.exec(rawLine);
    if (fenceOpen) {
      fenceChar = fenceOpen[1][0];
      fenceLength = fenceOpen[1].length;
      continue;
    }

    // Strip complete comments; an unclosed comment hides all remaining input.
    let visible = '';
    let cursor = 0;
    while (cursor < rawLine.length) {
      if (inHtmlComment) {
        const close = rawLine.indexOf('-->', cursor);
        if (close < 0) break;
        inHtmlComment = false;
        cursor = close + 3;
        continue;
      }
      const open = rawLine.indexOf('<!--', cursor);
      if (open < 0) {
        visible += rawLine.slice(cursor);
        break;
      }
      visible += rawLine.slice(cursor, open);
      inHtmlComment = true;
      cursor = open + 4;
    }
    const line = visible.trim();
    if (!line) {
      if (paragraph.length) break;
      continue;
    }

    const atxHeading = /^(#{1,6})\s+/.exec(line);
    if (atxHeading) {
      const level = atxHeading[1].length;
      if (paragraph.length) break;
      if (sectionLevel !== null && level <= sectionLevel) return '';
      if (sectionLevel === null) sectionLevel = level;
      continue;
    }

    // Setext underline applies to the preceding ordinary text line.
    const setextNext = /^(=+|-+)\s*$/.exec((lines[index + 1] || '').trim());
    if (setextNext) {
      const level = setextNext[1][0] === '=' ? 1 : 2;
      if (paragraph.length) break;
      if (sectionLevel !== null && level <= sectionLevel) return '';
      if (sectionLevel === null) sectionLevel = level;
      index += 1;
      continue;
    }

    if (/^>/.test(line)) {
      if (paragraph.length) break;
      return '';
    }

    // CommonMark horizontal rules allow whitespace between marker characters.
    if (/^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(rawLine)) {
      if (paragraph.length) break;
      continue;
    }
    paragraph.push(line.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, ''));
  }
  return cleanMarkdown(paragraph.join(' '), 180);
}
function makeReleaseSection({version, date, title, number, repository, body}) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('仅允许稳定版 SemVer');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('发布日期格式无效');
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('PR 编号无效');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('仓库名称无效');
  const safeTitle = cleanMarkdown(title, 140);
  if (!safeTitle) throw new Error('PR 标题为空');
  const summary = extractReleaseSummary(body);
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

module.exports = {cleanMarkdown,extractReleaseSummary,makeReleaseSection,insertReleaseSection,prepare};
