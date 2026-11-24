#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一次性脚本：修正底栏高亮与内容不对应（按实际滚动位置判定当前小节）。"""
import io, sys

P = sys.argv[1] if len(sys.argv) > 1 else 'v5.1.html'
s = io.open(P, encoding='utf-8').read()

OLD = """    var y=window.innerHeight*0.42, best=null, bestD=1e9;
    SECS.forEach(function(id){
      var el=$(id); if(!el) return;
      var d=Math.abs(el.getBoundingClientRect().top-y);
      if(d<bestD){bestD=d;best=id}
    });
    if(best&&best!=='sec-setup') setTab(best);"""
NEW = """    /* mwPick53：按“已经滚过 42% 线的最后一个小节”判定，避免短卡片把高亮抢走 */
    var y=56, best='sec-home';
    SECS.forEach(function(id){
      var el=$(id); if(!el) return;
      if(el.getBoundingClientRect().top<=y) best=id;
    });
    if(best==='sec-setup') best='sec-home';
    setTab(best);"""

if 'mwPick53' in s:
    print('%s: 底栏已修过，跳过' % P)
    sys.exit(0)
assert s.count(OLD) == 1, '!! 底栏判定代码命中 %d 次' % s.count(OLD)
s = s.replace(OLD, NEW, 1)
SC_OLD = """  window.addEventListener('scroll', function(){ if(!io) pick() }, {passive:true});"""
SC_NEW = """  /* mwPick53b：滚动过程中也按几何位置实时校正高亮 */
  var mwPend=false;
  window.addEventListener('scroll', function(){ if(mwPend)return; mwPend=true; requestAnimationFrame(function(){ mwPend=false; pick() }); }, {passive:true});"""
assert s.count(SC_OLD) == 1, '滚动监听命中 %d 次' % s.count(SC_OLD)
s = s.replace(SC_OLD, SC_NEW, 1)
io.open(P, 'w', encoding='utf-8').write(s)
print('%s: 底栏高亮已改为按滚动位置实时判定' % P)
