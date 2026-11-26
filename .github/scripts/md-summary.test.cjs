'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractSummary, cleanMarkdownText } = require('./md-summary.cjs');
test('extracts plain text and trims whitespace', () => {
  assert.equal(extractSummary('A useful change with   clean spacing.'), 'A useful change with clean spacing.');
});
test('prefers structured Release Summary over earlier prose', () => {
  assert.equal(extractSummary('Context paragraph.\n\n## Release Summary\n\nThe new timer supports weekly totals.\n\n## Details\n\nLong details.'), 'The new timer supports weekly totals.');
});
test('reads multiple structured paragraphs until next same-or-higher heading', () => {
  assert.equal(extractSummary('### Release Summary\n\nFirst part.\n\nSecond part.\n\n### Details\n\nIgnore.'), 'First part. Second part.');
});
test('uses legacy first paragraph when no structured heading exists', () => {
  assert.equal(extractSummary('The first paragraph explains the change.\n\nMore details.'), 'The first paragraph explains the change.');
});
test('does not treat blockquotes, inline code, or fenced code as summaries', () => {
  assert.equal(extractSummary('> quoted fake summary\n\n\`inline fake\`\n\n\`\`\`md\nRelease Summary\nFake code.\n\`\`\`', 'fix: fallback title'), 'fallback title');
});
test('ignores HTML comments including comments wrapping fenced code', () => {
  const body = '<!--\n## Release Summary\nFake comment.\n\`\`\`md\nRelease Summary\nFake code.\n\`\`\`\n-->\n\n<!-- ## Release Summary -->';
  assert.equal(extractSummary(body, 'fix: safe fallback'), 'fix: safe fallback');
});
test('ignores fake structured headings inside code and comments while finding real section', () => {
  const body = '\`\`\`md\n## Release Summary\nFake.\n\`\`\`\n\n<!-- ## Release Summary\nFake. -->\n\n## Release Summary\n\nReal summary.';
  assert.equal(extractSummary(body), 'Real summary.');
});
test('handles links, images, and inline formatting as readable text', () => {
  assert.equal(extractSummary('## Release Summary\n\nAdd **bold** [timer](https://example.com) and ![cat](https://example.com/cat.png).'), 'Add bold timer and cat.');
  assert.equal(cleanMarkdownText('feat: [click](https://evil.example) <script>bad</script>'), 'feat: click bad');
});
test('falls back to PR title when body has no usable paragraph', () => {
  assert.equal(extractSummary('<!-- empty -->\n\n\`\`\`text\nno summary\n\`\`\`', 'feat: add focus mode'), 'feat: add focus mode');
});
