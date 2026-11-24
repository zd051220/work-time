#!/usr/bin/env python3
"""一次性脚本：往 v5.1.html 插入「紧急计时规则」公告（带 15:12 自动移除）。"""
import io
import sys

P = sys.argv[1] if len(sys.argv) > 1 else 'v5.1.html'
UNTIL = 1795504320000  # 2026-11-24 15:12 北京时间（5.2 上线时刻）

BLOCK = """<!--URGENT_BEGIN-->
<div class="notice" id="urgentNotice" style="border-color:#f6c8bd;background:#fff3ef"><span class="ico">⚡</span><span class="txt"><b>紧急修正：计时规则已调整</b>：切后台或锁屏后 <b>3 小时</b>内回来会自动补全，不再中途打断（原来 30 分钟就会停下来等确认）。若数值停在原处并出现「需要核对一段计时」，点「确认全部计入」即可补齐。</span></div>
<script>(function(){var U=__UNTIL__;function off(){var el=document.getElementById('urgentNotice');if(el&&Date.now()>=U)el.remove()}off();setInterval(off,1000)})();</script>
<!--URGENT_END-->
""".replace('__UNTIL__', str(UNTIL))

s = io.open(P, encoding='utf-8').read()
if 'URGENT_BEGIN' in s:
    print('%s: 公告已存在，跳过' % P)
    sys.exit(0)
anchor = '<div class="notice" id="noticeBtn" role="button" tabindex="0">'
assert s.count(anchor) == 1, 'noticeBtn 锚点命中 %d 次' % s.count(anchor)
idx = s.index(anchor)
end = s.index('</div>', idx) + len('</div>')
s = s[:end] + '\n' + BLOCK + s[end:]
io.open(P, 'w', encoding='utf-8').write(s)
print('%s: 紧急公告已插入（%d 字符）' % (P, len(s)))
