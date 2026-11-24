# 小猫搬金条 · work-time

一个手机端的工作计时 / 搬金记录小工具。纯静态页面（HTML + 原生 JS），托管在 GitHub Pages，后端用 Supabase 做账号、云同步和站内留言板。

## 在线地址

| 页面 | 地址 |
| --- | --- |
| 站点根地址（自动跳转 5.4） | https://zd051220.github.io/work-time/ |
| 当前主页 5.4 | https://zd051220.github.io/work-time/v5.4.html |
| 完整账本（5.4） | https://zd051220.github.io/work-time/ledger54.html |
| 5.4.1 测试入口（独立，未切正式） | https://zd051220.github.io/work-time/test-5.4.1.html |
| 5.4.1 测试账本 | https://zd051220.github.io/work-time/ledger54-5.4.1.html |

## 当前文件

| 文件 | 说明 |
| --- | --- |
| `index.html` | 站点入口，5 秒后跳 `v5.4.html`，带兜底链接与历史入口 |
| `v5.4.html` | **当前正式版**：账号账本分库存、改密码、注销（清云端）、一个页面计时、跨午夜拆账 |
| `ledger54.html` | 5.4 的完整账本页 |
| `v5.4.1.html` | **测试版**：账号身份锁 + 删号不再假装成功 + 导入上限；未部署删号函数时只清云端账本 |
| `ledger54-5.4.1.html` | 5.4.1 的账本页 |
| `test-5.4.1.html` | 5.4.1 测试入口页 |
| `v5.3.html` / `v5.2.html` / `v5.1.html` | 历史版本，`index.html` 里有入口；5.3 可作回滚版 |
| `ledger.html` | 5.3 及更早版本共用的旧账本页 |
| `cat-game-beta.html` / `cat-game-1.0.html` | 小猫互动试玩入口与本体 |
| `version.json` | 版本提示数据，5.4 启动时读取 |
| `manifest.json` / `icon.svg` | PWA 清单与图标 |
| `.github/scripts/timer_check.js` | 发布前计时纯函数门禁（20 项断言） |
| `.github/workflows/release-manual.yml` | 手动发布流程：下载→哈希→门禁→单文件提交 |
| `supabase/functions/delete-account/index.ts` | 真正删号的 Edge Function，**尚未部署** |

## 计时规则

- 实际工作、带薪摸鱼都计薪；不带薪摸鱼暂停计薪。费率 = 日工资 / 标准工时 / 3600。
- **跨午夜**：一次打卡跨几个自然日，下班时拆成几条记录，每天只算当天工时与当日工资。
- 计时期间系统时间回退、或超过 3 小时没运行，会进入「待核对」状态，不会默默算错。

## 数据怎么存的

三层：本地一份、云端两份（记录 + 进行中打卡）。

- **本地**：主页和账本页同域名，共用 localStorage，key `catGold_v5`（按账号分库时为 `catGold_v5.u.<uid>`）。
- **登录态**：key `mw_acct_v1`（token、refresh、uid、昵称、过期时间）。access token 1 小时过期，到期前自动续期；401 重试一次。
- **云端记录**：Supabase 表 `records`，主键 `user_id + id`，RLS 只能读写自己的行；`feedback` 表做留言板（免登录可读可发）。
- **进行中打卡**：写在当前用户的 `user_metadata.session`，登录后定时去重推送。

## 后端配置（Supabase）

- 项目 URL 与 publishable key 写在页面的 `SB` / `SBK` 常量（publishable 可公开，**secret key 绝不能进页面或仓库**）。
- Auth：邮箱提供商开启、关闭确认邮件、允许注册。用户名拼成 `用户名@xiaomao.local` 伪邮箱，只能小写字母/数字/下划线，2–20 位。
- `feedback` 表只有 select / insert，清理测试留言要用 Dashboard SQL Editor。

## 修改和上线

- 改页面：直接编辑对应 `.html`，提交到 `main`，约 1 分钟后生效；缓存不更新时地址后加 `?v=2`。
- 发新版：走 Actions → `release-manual` → Run workflow，填文件名、CDN 地址、SHA-256、提交说明；流程会跑计时门禁、限制只改一个文件，**不会自动改入口**。
- 浏览器缓存：改了没生效，强刷一次。

## 文件命名规范

- 主程序版本：`v主版本.次版本.修订.html`，一个版本一个文件，不覆盖旧的。
- 固定页面用通用名：`index.html`（站点入口）、`ledger.html`（5.3 及更早的账本）、`ledger54.html`（5.4 账本）。
- 游戏：本体 `cat-game-<版本>.html`，测试版外壳 `cat-game-beta.html`。
- PWA：`manifest.json` + `icon.svg`。
