#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""5.3 更新公告：弹窗改成 5.3 的内容，去重键换成 mw_notice_53。"""
import io

P3 = 'v5.3.html'
s = io.open(P3, encoding='utf-8').read()

old_head = """  <h3>小猫搬金条 5.1 更新公告</h3>
  <div class="ver">2026-11-24 更新 · 共 4 项（进站自动弹出，24 小时内不再重复）</div>
  <ul>
   <li><b>跨午夜打卡（重要）</b>：上班到第二天甚至更久，下班时会按自然日自动拆成多条记录，每天的工资各算各的，不再把跨天的工时全记到上班那天。</li>
   <li><b>进行中打卡上云</b>：正在计时的状态也会同步到云端（登录后），换手机用同一账号登录能接着算，不用重新打卡。</li>
   <li><b>导入三保险</b>：导入前自动导出一份当前数据、显示新增/重复条数让你确认、重复记录自动跳过，不会把账本搞乱。</li>
   <li><b>账号卡对齐</b>：用户名和密码的标签改成单行，输入框对齐，去掉了占位提示文字。</li>
  </ul>"""

new_head = """  <h3>小猫搬金条 5.3 更新公告</h3>
  <div class="ver">2026-11-24 更新 · 共 4 项（进站自动弹出，24 小时内不再重复）</div>
  <ul>
   <li><b>只让一个页面计时（重要）</b>：同一台设备只留一个页面在计时，其余标签变只读并提示「接管计时」。不会两个页面各记一份、工时翻倍。</li>
   <li><b>挂机更省电</b>：空闲时每秒只做必要检查，页面改动从每秒二十多次降到一两次，手机更省电、更不烫。</li>
   <li><b>账本不再捣乱</b>：在账本页删一条记录，不会再把打卡时间往回倒、让工时对不上。</li>
   <li><b>计时更准</b>：锁屏、切后台不再被误判成「设备改时间」，离线 3 小时以内回到页面会自动补记。</li>
  </ul>"""

if '小猫搬金条 5.3 更新公告' in s:
    print('5.3.html: 弹窗已是 5.3，跳过')
else:
    assert s.count(old_head) == 1, 'v5.3 弹窗锚点命中 %d 次' % s.count(old_head)
    s = s.replace(old_head, new_head, 1)
    print('5.3.html: 弹窗内容 -> 5.3')

if "NOTICE_KEY='mw_notice_53'" in s:
    print('5.3.html: 去重键已是 mw_notice_53，跳过')
else:
    assert s.count("NOTICE_KEY='mw_notice_51'") == 1
    s = s.replace("NOTICE_KEY='mw_notice_51'", "NOTICE_KEY='mw_notice_53'", 1)
    print('5.3.html: 去重键 -> mw_notice_53')

io.open(P3, 'w', encoding='utf-8').write(s)

P2 = 'v5.2.html'
t = io.open(P2, encoding='utf-8').read()
old_bar2 = '<b>5.1 更新公告</b>：跨午夜拆账、打卡状态上云、导入三保险'
if '<b>5.2 更新公告</b>' in t:
    print('5.2.html: 公告条已是 5.2，跳过')
else:
    assert t.count(old_bar2) == 1
    t = t.replace(old_bar2, '<b>5.2 更新公告</b>：云端删的记录不再复活、计时只记当前设备', 1)
    io.open(P2, 'w', encoding='utf-8').write(t)
    print('5.2.html: 公告条 -> 5.2')
