#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把页头版本号和顶部公告条改成对应版本。"""
import io

def fix(path, ver, strip_old=None, strip_new=None):
    s = io.open(path, encoding='utf-8').read()
    brand_old = '<span style="font-size:11px;color:#b58b4a">5.1</span>'
    brand_new = '<span style="font-size:11px;color:#b58b4a">%s</span>' % ver
    if brand_new in s:
        print('%s: 页头已是 %s，跳过' % (path, ver))
    else:
        assert s.count(brand_old) == 1, '%s 页头版本号命中 %d 次' % (path, s.count(brand_old))
        s = s.replace(brand_old, brand_new, 1)
        print('%s: 页头版本号 -> %s' % (path, ver))
    if strip_old and strip_old in s:
        assert s.count(strip_old) == 1
        s = s.replace(strip_old, strip_new, 1)
        print('%s: 顶部公告条已更新' % path)
    io.open(path, 'w', encoding='utf-8').write(s)

fix('v5.2.html', '5.2')
fix('v5.3.html', '5.3',
    '<b>5.1 更新公告</b>：跨午夜拆账、打卡状态上云、导入三保险',
    '<b>5.3 更新公告</b>：只让一个页面计时、挂机更省电、账本不再捣乱')
