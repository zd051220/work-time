'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const html=fs.readFileSync('v5.5.html','utf8');
test('four distinct kitten drawings and real bullion props exist',()=>{for(let i=0;i<4;i++)assert.ok(html.includes('class="cat-art cat-art-'+i+'"'));assert.equal((html.match(/class="gold-bar"/g)||[]).length,4);assert.match(html,/GOLD/);});
test('timer state mapping covers work, paid break, unpaid break and clock-out celebration',()=>{for(const state of ["s.mode==='work'?'work'","s.mode==='paid'?'paid':'unpaid'","mwCatOffUntil","?'off':'idle'"])assert.ok(html.includes(state));});
test('cat interactions are separate from accounting and storage',()=>{const i=html.indexOf("$('cat').addEventListener('click'");const j=html.indexOf("$('startBtn').onclick",i);assert.ok(i>=0&&j>i);assert.doesNotMatch(html.slice(i,j),/localStorage|data\.records|save\(|accrue\(/);});
test('reduced motion and keyboard interaction remain supported',()=>{assert.match(html,/prefers-reduced-motion:reduce/);assert.match(html,/e\.key==='Enter'/);});
