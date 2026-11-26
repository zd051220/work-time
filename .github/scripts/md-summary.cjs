'use strict';

const MarkdownIt = require('markdown-it');
const parser = new MarkdownIt({ html: true, linkify: false, typographer: false });

function inlineText(tokens) {
  return (tokens || []).map(token => {
    if (token.type === 'text') return token.content;
    if (token.type === 'image') return token.content || '';
    if (token.type === 'code_inline' || token.type === 'html_inline') return '';
    if (token.children) return inlineText(token.children);
    return '';
  }).join('');
}

function normalize(value, limit = 180) {
  return value.split(/[\r\n\t ]+/).filter(Boolean).join(' ').trim().slice(0, limit);
}

function topLevelBlocks(source) {
  const tokens = parser.parse(source, {});
  const blocks = [];
  let quoteDepth = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === 'blockquote_open') { quoteDepth += 1; continue; }
    if (token.type === 'blockquote_close') { quoteDepth -= 1; continue; }
    if (quoteDepth !== 0) continue;
    if (token.type === 'heading_open' || token.type === 'paragraph_open') {
      const inline = tokens[i + 1];
      if (inline && inline.type === 'inline') {
        blocks.push({
          type: token.type === 'heading_open' ? 'heading' : 'paragraph',
          level: token.type === 'heading_open' ? Number(token.tag.slice(1)) : 0,
          text: inlineText(inline.children)
        });
      }
    }
  }
  return blocks;
}

function cleanMarkdownText(value, limit = 180) {
  if (typeof value !== 'string' || !value.trim()) return '';
  return normalize(topLevelBlocks(value).map(block => block.text).filter(Boolean).join(' '), limit);
}

function extractSummary(body, title = '', limit = 180) {
  const fallback = cleanMarkdownText(title, limit);
  if (typeof body !== 'string' || !body.trim()) return fallback;
  const blocks = topLevelBlocks(body);
  const headingIndex = blocks.findIndex(block =>
    block.type === 'heading' && normalize(block.text, 80).toLowerCase() === 'release summary'
  );
  if (headingIndex >= 0) {
    const depth = blocks[headingIndex].level;
    const parts = [];
    for (let i = headingIndex + 1; i < blocks.length; i += 1) {
      const block = blocks[i];
      if (block.type === 'heading' && block.level <= depth) break;
      if (block.type === 'paragraph' && block.text) parts.push(normalize(block.text, limit));
    }
    const structured = normalize(parts.join(' '), limit);
    if (structured) return structured;
  }
  const legacy = blocks.find(block => block.type === 'paragraph' && block.text);
  return legacy ? normalize(legacy.text, limit) : fallback;
}

module.exports = { cleanMarkdownText, extractSummary };
