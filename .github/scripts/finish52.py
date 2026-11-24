#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""5.2 收尾：插入猫猫游戏彩蛋 + 入口页链接改成新文件名。"""
import io

def read(p): return io.open(p, encoding='utf-8').read()
def write(p, s): io.open(p, 'w', encoding='utf-8').write(s)

p = 'v5.2.html'; s = read(p)
anchor = '<section class="card" id="sec-account">'
if 'cat-game-beta.html' not in s:
    egg = ('<div style="text-align:center;margin:2px 0 16px">'
           '<a href="cat-game-beta.html" style="font-size:10px;color:#ddd0bb;text-decoration:none">'
           '🐾 听说这儿藏了只猫…</a></div>')
    assert s.count(anchor) == 1, 'anchor not unique'
    write(p, s.replace(anchor, egg + '\n' + anchor))
    print('5.2: 彩蛋已插入')
else:
    print('5.2: 彩蛋已存在')

i = read('index.html')
changed = False
if 'xiaomao-banjin-5.2.html' in i:
    i = i.replace('xiaomao-banjin-5.2.html', 'v5.2.html'); changed = True
if 'xiaomao-banjin-5.1.html' in i:
    i = i.replace('xiaomao-banjin-5.1.html', 'v5.1.html'); changed = True
if changed:
    write('index.html', i)
    print('index: 旧文件名已改成 v5.x.html')
else:
    print('index: 文件名已是最新')
