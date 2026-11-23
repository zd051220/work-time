# 小猫搬金条 · work-time

一个手机端的工作计时 / 搬金记录小工具。纯静态页面（HTML + 原生 JS），托管在 GitHub Pages，后端用 Supabase 做账号、云同步和站内留言板。

## 在线地址

| 页面 | 地址 |
| --- | --- |
| 主页（当前版本 5.0.2） | https://zd051220.github.io/work-time/xiaomao-banjin-5.0.2.html |
| 完整账本 | https://zd051220.github.io/work-time/ledger.html |
| 站点根地址 | https://zd051220.github.io/work-time/ （自动跳转到 5.0.2） |

## 文件说明

| 文件 | 说明 |
| --- | --- |
| `index.html` | 站点入口，0 秒跳转到 `xiaomao-banjin-5.0.2.html`，只放了一个兜底链接 |
| `xiaomao-banjin-5.0.2.html` | **当前在用的主页**：打卡计时、带薪/不带薪摸鱼、今日账单、月度账本（可删单条）、底部导航、账号云同步、留言板、备份导出 |
| `ledger.html` | **完整账本页**：按月切换、本月累计、计薪时长、日均、近六个月柱状图、明细删除、导出/导入；与主页共用登录态，删除与导入会同步云端 |
| `xiaomao-banjin-5.0.1.html` | 历史版本（5.0.1），保留备用，不建议日常使用 |
| `xiaomao-cat-game-preview-1.0.html` | 独立的小猫互动试玩版（猫咪乐园），与记账主功能无关 |
| `xiaomao-502-short-link.zip` | 早期打包文件 |

## 数据怎么存的

两层：本地一份 + 云端一份（登录后）。

- **本地**：主页和账本页同域名，共用 localStorage，key 是 `catGold_v5`；首次打开会自动迁移旧版 `catGold_v4 / v3 / v2`。
- **登录态**：另存一个 key `mw_acct_v1`（token、refresh token、uid、昵称）。access token 1 小时过期，前端到期前会自动用 refresh token 续期；续期失败会提示重新登录，不会再静默失败。
- **云端**：Supabase 表 `records`（主键 `user_id + id`，RLS 只允许本人读写）和 `feedback`（留言板，免登录可读可发）。
- 同步时机：登录/注册后自动同步、下班打卡推单条、删除记录同步删云端、导入备份后推全量、账本页打开时拉取一次。

数据安全：本地清缓存/换设备前先「导出备份」；云端只存登录用户自己的记录，别人的账号看不到。

## 后端配置（Supabase）

- 项目 URL 与 publishable key 写在页面里的 `SB` / `SBK` 常量（publishable 可以公开，**secret key 绝不能写进页面或仓库**）。
- Auth：邮箱提供商开启、关闭“确认邮件”（用户名登录不需要收验证邮件）、允许新用户注册。前端把用户名拼成 `用户名@xiaomao.local` 的伪邮箱，所以用户名只能用小写字母/数字/下划线，2–20 位。
- 改这些前先看 Supabase 控制台 → Authentication → Providers / Settings。

## 修改和上线

仓库是 GitHub Pages，`main` 分支根目录即站点。改完提交到 `main`，等 1 分钟左右自动生效。

- 改页面：直接编辑对应的 `.html` 文件
- 新增页面：放根目录，用相对路径互相链接即可
- 浏览器缓存：如果改了没生效，在地址后面加 `?v=2` 这类参数强刷一次
