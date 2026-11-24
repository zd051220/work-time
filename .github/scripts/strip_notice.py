#!/usr/bin/env python3
"""发布 5.2 时把紧急公告块整段删掉（公告已到期）。"""
import io
import re
import sys

P = sys.argv[1] if len(sys.argv) > 1 else 'v5.2.html'
s = io.open(P, encoding='utf-8').read()
if 'URGENT_BEGIN' not in s:
    print('%s: 无紧急公告' % P)
    sys.exit(0)
s2 = re.sub(r'<!--URGENT_BEGIN-->.*?<!--URGENT_END-->\n?', '', s, flags=re.S)
assert 'URGENT_BEGIN' not in s2 and 'urgentNotice' not in s2, '公告未清除干净'
io.open(P, 'w', encoding='utf-8').write(s2)
print('%s: 已移除紧急公告（%d -> %d 字符）' % (P, len(s), len(s2)))
