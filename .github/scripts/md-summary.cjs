'use strict';
const unified = require('unified');
const remarkParse = require('remark-parse');
const processor = unified().use(remarkParse);
function inlineText(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text' || node.type === 'inlineCode') return node.value || '';
  if (node.type === 'image') return node.alt || '';
  if (['link','linkReference','emphasis','strong','delete','paragraph','heading'].includes(node.type))
    return (node.children || []).map(inlineText).join('');
  return '';
}
function normalize(value, limit = 180) {
  return value.split(/[\r\n\t ]+/).filter(Boolean).join(' ').trim().slice(0, limit);
}
function cleanMarkdownText(value, limit = 180) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const tree = processor.parse(value);
  return normalize((tree.children || []).map(node =>
    node.type === 'paragraph' || node.type === 'heading' ? inlineText(node) : ''
  ).filter(Boolean).join(' '), limit);
}
function extractSummary(body, title = '', limit = 180) {
  const fallback = cleanMarkdownText(title, limit);
  if (typeof body !== 'string' || !body.trim()) return fallback;
  const nodes = processor.parse(body).children || [];
  let headingIndex = -1;
  let headingDepth = 7;
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node.type === 'heading' && normalize(inlineText(node), 80).toLowerCase() === 'release summary') {
      headingIndex = i; headingDepth = node.depth; break;
    }
  }
  if (headingIndex >= 0) {
    const parts = [];
    for (let i = headingIndex + 1; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (node.type === 'heading' && node.depth <= headingDepth) break;
      if (node.type === 'paragraph') {
        const value = normalize(inlineText(node), limit);
        if (value) parts.push(value);
      }
    }
    const structured = normalize(parts.join(' '), limit);
    if (structured) return structured;
  }
  for (const node of nodes) {
    if (node.type === 'paragraph') {
      const legacy = normalize(inlineText(node), limit);
      if (legacy) return legacy;
    }
  }
  return fallback;
}
module.exports = { cleanMarkdownText, extractSummary };
