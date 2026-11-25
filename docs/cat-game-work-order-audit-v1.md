# 猫咪冒险工坊 · 工作订单系统审计记录（v1）

分支：`feature/cat-game-cloud-v1`　审计基线：`f061db0`　日期：2026-11-26

本文件只记录**已经读过代码并核对过**的结论。没验证的写在最后一节，不要当成已完成。

## 一、核对结论：前端 RPC 与 SQL 函数签名

| 前端调用（cat-workshop.html → 主页面桥 → PostgREST） | SQL 函数（20261126020000 迁移） | 结论 |
| --- | --- | --- |
| `game_bootstrap()` | `public.game_bootstrap()` → `private.game_bootstrap()` | 一致 |
| `game_get_snapshot()` | `public.game_get_snapshot()` → `private.game_get_snapshot()` | 一致 |
| `game_start_work` + `p_job_code / p_duration_minutes / p_idempotency_key` | `private.game_start_work(text,integer,text)` | 一致 |
| `game_claim_work` + `p_order_id` | `private.game_claim_work(uuid)` | 一致 |

主页面桥只放行这 4 个 RPC，token 不进 iframe；客户端只提交岗位代码、时长、幂等 key、订单 UUID，不提交奖励金额。

## 二、逐项检查结果

| 检查项 | 结论 |
| --- | --- |
| 工作订单状态变化 | `active` → `claimed` 由服务端写入。表里定义的 `completed` 没有任何代码会写入，属于预留值。 |
| 金币流水 | `game_wallets` 行锁 → 余额增加 → 写 `game_wallet_ledger`（`work:<order_id>` 幂等键、`balance_after`）。`coins=0` 时不写流水。 |
| 重复领取 | 同一用户 advisory 锁 + 订单行 `for update`；已 `claimed` 直接返回快照，不重复加钱。 |
| 服务器时间 | 开始时间、完成时间、领取判断全部用 `clock_timestamp()`，客户端时间不参与判定。 |
| 单人单订单 | advisory 锁 + 唯一索引 `game_work_orders_one_active_per_user_idx` 双重保证。 |
| 岗位关闭不影响已开始的订单 | 领取时按 `job_code` 查目录，不要求 `is_active`。 |
| 奖励来源 | 只读 `game_job_catalog.rewards_by_duration`，该列对客户端不可读；上限 100000。 |
| 用户隔离 | 13 张游戏表全部开 RLS，只给 `select` 自己的行；写操作只能走服务端函数。 |

## 三、本次修复的问题

1. **倒计时按手机时间判断是否可领取（已修）**
   旧逻辑用 `Date.now()` 和 `completes_at` 比较。手机时间慢几分钟，服务器已经完成，按钮仍然灰着点不了；手机时间快，则提前亮起、点了被服务器拒绝。
   现在 `game_get_snapshot()` 返回 `server_now`，页面据此校正本机时钟偏差；服务器仍然是唯一判定方。
2. **领取后倒计时定时器不停（已修）**
   订单领完后 1 秒一次的定时器仍在空转。现在每次重绘先清掉旧定时器。
3. **开始工作失败后页面与服务器不一致（已修）**
   响应丢失但订单已创建时，按钮恢复可点，再点只会一直报错。现在失败后自动重新拉取存档，以服务器状态为准。
4. **服务器错误直接显示原始 JSON（已修）**
   例如 `{"code":"55000",...,"message":"work_order_not_finished"}`。现在翻译成中文；未知错误码原样显示。
5. **快照返回全部历史订单（已修，SQL）**
   每次请求都带上所有 `claimed` 订单，做过的单子越多响应越大。现在只带最近 10 条已领取记录，未结束的订单仍然全量返回。
6. **岗位目录暴露未配置奖励的时长（已修，SQL）**
   玩家能看到并选择一个没有奖励配置的时长，点了才报错。现在只暴露服务端已配置奖励的时长；一个都没有时页面显示“暂未开放工作时长”。
7. **重复开始工作只有唯一索引报错（已修，SQL）**
   原来返回约束名很长的数据库错误。现在先显式判断并返回 `work_already_in_progress`，唯一索引继续作为兜底。

## 四、新增的自动化检查

`.github/scripts/cat_work_order_check.js`（已接入 `code-audit` 工作流）：用最小 DOM 桩直接运行 `cat-workshop.html` 里真实的内联脚本，覆盖：

- 手机时间慢 5 分钟时，服务器到点后领取按钮必须可点（修改前的文件跑这项会失败）
- 连点两次只发一次 `game_claim_work`，且只带订单 UUID
- 领取完成后倒计时定时器数量为 0
- `game_start_work` 只带岗位、时长、幂等 key，不带任何奖励字段
- 开始失败后显示中文原因、按钮恢复、并自动重新拉取存档
- 未配置奖励的岗位不可开始
- 主页面桥白名单仍是 4 个 RPC，且不向 iframe 传 token

`cat_game_migration_check.js` 增加 4 条断言：快照带服务器时间、已领取历史有上限、重复开始有可读错误、目录只暴露已配置奖励的时长。

## 五、云端存档与页面绑定现状

| 数据 | 页面是否已读取云端快照 |
| --- | --- |
| 金币、等级、生命值、猫咪名字 | 是 |
| 背包（前 12 种） | 是 |
| 已穿戴装备（6 个位置） | 是 |
| 工作订单、岗位目录 | 是 |
| 经验、攻击、防御、幸运、挖矿能力 | 否（快照里有，页面未展示） |
| 饱食度、心情、好感度 | 否（家园页写着“云端待接入”） |
| 职业成长 `jobs`、地图进度 `world`、任务、成就 | 否（快照里有，页面仍是静态内容） |

## 六、没有验证的部分

- 两个游戏迁移文件**没有在 Supabase 执行**，本次 SQL 改动同样没有在真实 Postgres 上跑过，只过了静态断言。
- 没有 PostgREST 端到端测试：开始 → 等待 → 领取 → 金币和流水变化的完整链路未在真实环境跑过。
- 六个岗位的奖励数值仍未配置（`rewards_by_duration` 为空、`is_active` 为 false），按约定不由前端或 AI 擅自填写。
- 没有真机测试（iOS Safari、微信内置浏览器、Android Chrome）。
- 主页面桥对不合法的参数仍然是不回复、等 iframe 12 秒超时。正常使用不会触发；以后新增第七种岗位代码时需要同步修改桥里的白名单。
- 迁移历史基线问题（仓库缺少部分历史 SQL）没有处理，按交接要求不擅自在线执行迁移。
