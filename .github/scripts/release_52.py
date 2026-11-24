#!/usr/bin/env python3
"""5.2 定时上线脚本（由 GitHub Actions 调用，也可在本地手动跑）。

做的事：
1. 读取仓库里的 xiaomao-banjin-5.1.html，打上 5.2 补丁（删除墓碑 / 计时归属 / 留言板统计），
   写出 v5.2.html；
2. 把 ledger.html 升级为 5.2（同样支持删除墓碑）；
3. 写入 manifest.json、icon.svg，把 index.html 换成 5.2 上线页。

补丁以「原文片段 -> 新片段」的形式内嵌，逐条断言只命中一次，避免误改。
"""
import base64, gzip, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MAIN = os.path.join(ROOT, 'v5.1.html')
LEDGER = os.path.join(ROOT, 'ledger.html')

B_PAIRS = "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"
B_INDEX = "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"
B_MANIFEST = "H4sIANHpBGsC/62PwUrDQBCG73mKsB6NLehJr959AZEy3WySpZvdsLsR09KDBxGkUHsVpQjqRS31VqGPU5P05Cu4yzainj3O93/zMzPwfB9xSAk68NHHfFyNnsvrl/XlpLy7R4ENVSKk7jTKnzAkCkuaaSq4TVeLq2r8Ws8eqtvpt/m5HJWTxfptuXqf1k/n9WxeLi7Kx5tNvQZTn0tm91vtDcQiIz9BSFXGoLDILPAQmODERUJSwjU0J2TmWglUu7ALuBdLkfOwgwUT0hpbURRBtOsEnZCU/M72wn2XMeCxhf1k5/DIIYoFV4Ydm8H3B+Yaia1ieUudxigwiPaJdRDwws66cL/QFGLSNtL2WcpskOUyE4o0qj8M/rk1BdWDLiOm2jSfeEPvC94YaL3vAQAA"
B_ICON = "H4sIANHpBGsC/61UTXObMBC951dslUs7GYy+kKEDOfTSS/IHesNCGCYYCGBj59d3BcaDHcdJZ3oAaVf7Hk9PK8J2t4b9pijbiGRdV/903b7vF71YVM3a5ZRSFysI7HLT/6r2EaFAwWPcPgT6POmyiAzzzOTrrBuDxzuAMDFpayc4LfLSxM3vJk5yU3aQJxFZIemeIR+Bwzjs+RjhwMgIRGjbVTVUadqabli2saOromoicp+mKUs4ca9Xs8vqZZLGaqoO3XNVH0tNt83/0LrSSqRf1Wr82OP6ltbQnQwOG6O7D88CGjy1QBFI86KIyLYpvt+v1j9G6vCb4wASt+A4Q1zHXQa452cmODDlwxPzKAQKnjiTYJN/zpjQm4nqBBU+HaFC8REa+LehVkVm4mRSofNGFwY0KuceStcHnCgf94JOcXWLZrN9e0PokcgURV63F0yCqtEVZUdMeHRitB3lGzU352Daq2zW2kGXPHrMvJGNBSc2GQuPyyPbHC0o/Uf03BK2PIKFGizx5vLf1wvqfV5v91pWKO8BNtUWT/KyIdA+4L4Phe0DDg4O/vB2/LcTXxIoOTX5OVRQH3aMwhgwH14dfFm4kMBn6TFrk/ZKNNWLQd44WCqpp4Rz7HU5fbesSnNatFdFx3VEmmpbJrPt9VnevphrvY4NiycCmeOhkiHiHCOp4Flg3w5rdmkI7JJUM3E6CGIlroj7TJDO8hLaDO90uX4vCm+OQFNeFQVpLcc/7+yjhgYxl5cfVV9xBKo61nmHDbEQnpUT2n/8491fDNpgmAwGAAA="


def unblob(s):
    return gzip.decompress(base64.b64decode(s)).decode('utf-8')


def apply(text, pairs, name):
    for old, new in pairs:
        n = text.count(old)
        if n != 1:
            print('!! %s 补丁命中 %d 次（应为 1）：%r' % (name, n, old[:60]))
            sys.exit(1)
        text = text.replace(old, new, 1)
    return text


def main():
    pairs = json.loads(unblob(B_PAIRS))

    src = open(MAIN, encoding='utf-8').read()
    out = apply(src, pairs['main'], 'main')
    if 'record_dels' not in out:
        print('!! 5.2 补丁不完整：没有 record_dels')
        sys.exit(1)
    open(os.path.join(ROOT, 'v5.2.html'), 'w', encoding='utf-8').write(out)

    led = open(LEDGER, encoding='utf-8').read()
    if 'record_dels' in led:
        print('ledger.html 已经是 5.2，跳过')
    else:
        open(LEDGER, 'w', encoding='utf-8').write(apply(led, pairs['ledger'], 'ledger'))

    open(os.path.join(ROOT, 'manifest.json'), 'w', encoding='utf-8').write(unblob(B_MANIFEST))
    open(os.path.join(ROOT, 'icon.svg'), 'w', encoding='utf-8').write(unblob(B_ICON))
    open(os.path.join(ROOT, 'index.html'), 'w', encoding='utf-8').write(unblob(B_INDEX))
    print('5.2 已完成：v5.2.html / ledger.html / index.html / manifest.json / icon.svg')


if __name__ == '__main__':
    main()
