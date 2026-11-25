# 猫咪冒险工坊：云端存档与数据库架构 V1

> 状态：设计基线（尚未创建游戏表、尚未部署游戏 RPC）
> 目标分支：feature/cat-game-cloud-v1
> 现有工时业务保持不变；游戏数据独立于 records / work_sessions。

## 1. 架构决策

- Supabase Postgres 是游戏唯一权威存档。
- 浏览器不持久化金币、经验、装备、库存、战斗结果或奖励；客户端状态只用于渲染。网络断开时进入只读/重连状态，不提交离线队列。
- 所有经济和进度变更采用“命令式 RPC”，客户端提交动作与幂等键，服务端校验后在单个事务中写入。
- Realtime 只用于通知“数据可能更新”，收到通知后重新读取快照；不把 Realtime 广播当作权威数据。
- 多设备通过行锁、revision 乐观并发控制和幂等键协调；禁止客户端整份覆盖游戏存档。
- 游戏表与函数采用 game_ 前缀；工时账本表和现有云同步逻辑不改造、不复用为游戏存档。

## 2. 建议 schema 与数据表

第一阶段核心表（先做单人游戏）：

| 表 | 关键字段 / 责任 |
| --- | --- |
| public.game_profiles | user_id PK -> auth.users；public_name、handle、bio、visibility、created_at、updated_at、revision |
| public.game_cats | user_id PK；skin_code、level、xp、hp、attack、defense、luck、mining_power、satiety、mood、affection、revision |
| public.game_wallets | user_id PK；coins BIGINT、revision、updated_at；余额是账本的快速投影 |
| public.game_wallet_ledger | id、user_id、delta、reason、source_type、source_id、idempotency_key、balance_after、created_at；追加式，不允许客户端 UPDATE/DELETE |
| public.game_item_catalog | item_code PK、category、rarity、stack_limit、metadata；由迁移/管理端维护，客户端只读 |
| public.game_inventory | user_id + item_code PK、quantity、updated_at；禁止负库存 |
| public.game_equipment | equipment_id、user_id、item_code、slot、quality、level、affixes、is_equipped、created_at；装备为独立实例 |
| public.game_jobs | user_id + job_code PK、level、xp、specialization、updated_at |
| public.game_work_orders | order_id、user_id、job_code、started_at、completes_at、status、claimed_at、idempotency_key；每名玩家最多一份进行中的自动工作 |
| public.game_world_progress | user_id + zone_code PK、max_floor、unlocked_at、updated_at |
| public.game_battles | battle_id、user_id、encounter_code、status、server_seed、battle_state、started_at、resolved_at、result；战斗过程和结果由服务端决定 |
| public.game_task_progress | user_id、task_code、period_key、progress、completed_at、claimed_at；唯一键防止重复领奖 |
| public.game_achievements | user_id + achievement_code PK、unlocked_at、progress |

第二阶段家园与社交表：

| 表 | 关键字段 / 责任 |
| --- | --- |
| public.game_homes | user_id PK、house_level、layout JSONB、revision、updated_at |
| public.game_friends | pair_low、pair_high、requested_by、status、created_at、updated_at；规范化好友对，防止重复好友关系 |
| public.game_home_visits | owner_id、visitor_id、visited_at；服务端限频 |
| public.game_home_likes | owner_id、visitor_id、created_at；唯一约束防重复点赞 |
| public.game_leaderboard_snapshots | board_code、period_key、user_id、score、rank、generated_at；仅服务端生成 |

注：
- 不把所有游戏状态塞进单个 JSONB 大对象；结构化资源、装备、工作单和战斗分别存表。
- 角色皮肤、家具和物品目录由服务端目录定义；玩家拥有的实例/数量独立存储。
- 不设计玩家间自由交易；初版社交只开放主页、好友、家园访问、点赞和排行榜。
- 排行榜只展示公开字段，不公开用户 ID、邮箱、令牌或私人游戏数据。

## 3. 权限与安全边界

- 对 public 中每张 game_ 表启用 RLS。
- 玩家私有数据策略限定 TO authenticated，并使用 auth.uid() = user_id；UPDATE 同时设置 USING 与 WITH CHECK。
- 客户端仅获得所需 SELECT 权限。钱包、库存、装备、任务领奖、工作结算、战斗结果等表不允许客户端直接 INSERT/UPDATE/DELETE。
- 目录表仅开放 SELECT；排行榜快照只开放受控读取。
- 所有受保护写操作通过 public schema 中显式授权的窄接口 RPC 调用；实际特权逻辑放在 private schema，使用 SECURITY DEFINER 时固定空 search_path、显式验证 auth.uid()、最小权限，并撤销 PUBLIC/anon 的 EXECUTE。
- 不使用 user_metadata 作为权限依据；管理员身份如未来需要，必须由受保护服务端数据判定。
- 公开主页和好友访问通过只返回白名单字段的 RPC/视图实现，不能直接开放玩家私有表。
- 不把 Supabase service_role / secret key 放进 HTML、JS 或 Git 仓库。

## 4. 云端同步协议

### 登录与启动
1. 从现有 v5.5 登录态取得当前 Supabase access token；不得建立第二套账号系统。
2. 调用 game_bootstrap() 幂等创建初始 profile、cat、wallet。
3. 调用 game_get_snapshot() 读取当前用户的权威快照及各模块 revision。
4. 客户端仅将快照装入内存状态；重新载入页面后重新从云端拉取。

### 写入
1. 玩家点击动作，客户端生成 UUID 幂等键。
2. 调用对应 RPC（例如 game_buy_item / game_start_job / game_claim_job）。
3. 数据库事务锁定相关玩家行，检查余额、物品数量、工作状态、冷却时间、revision 和幂等键。
4. 同一事务内写入账本、余额投影、库存、进度和事件记录。
5. 返回服务器计算后的新快照和 revision；客户端只使用返回值更新画面。

### 多设备冲突
- 对玩家核心行 SELECT ... FOR UPDATE，串行处理涉及同一钱包/猫咪/库存的动作。
- 客户端提交 expected_revision；不匹配时返回明确冲突码，客户端重新拉取快照，不自动覆盖服务器数据。
- 幂等键按 user_id + action + idempotency_key 唯一；重复请求返回第一次结果，不重复扣款/发奖。
- Realtime 推送仅触发重新拉取；不得直接用广播 payload 覆盖本地权威状态。

### 离线
- 游戏断网时显示最近一次内存快照并标记“离线/只读”；页面刷新后无本地存档则显示重新连接提示。
- 离线期间不执行购买、喂食、挖矿、战斗、领奖等变更；不排队回放命令。
- 自动工作以服务端 started_at / completes_at 结算，最多按规则累计 8 小时；不得相信客户端时钟。

## 5. 关键 RPC 清单

第一阶段：
- game_bootstrap()：幂等初始化。
- game_get_snapshot()：读取本人权威存档。
- game_buy_item(item_code, quantity, idempotency_key)：服务端校验目录与金币。
- game_feed_cat(item_code, idempotency_key)：扣除食物并更新饱食度。
- game_interact_cat(action_code, idempotency_key)：抚摸/玩耍/休息，服务端限频。
- game_start_job(job_code, duration_code, idempotency_key)：检查岗位、时长、唯一活动工作并写服务器时间。
- game_claim_job(order_id, idempotency_key)：仅在服务器完成时间后结算。
- game_explore(zone_code, floor, idempotency_key)：校验解锁和体力，生成服务器战斗遭遇。
- game_resolve_battle(battle_id, idempotency_key)：服务端计算战斗，发放掉落和经验。

第二阶段：
- game_update_home(layout, expected_revision, idempotency_key)
- game_send_friend_request(handle, idempotency_key)
- game_respond_friend_request(request_id, accept)
- game_get_public_profile(handle)
- game_get_friend_home(user_id)
- game_like_home(owner_id, idempotency_key)
- game_get_leaderboard(board_code, period_key)

所有 RPC 只接收动作参数，不接收客户端声称的最终金币余额、掉落结果、伤害结果或排行榜分数。

## 6. 真实工时奖励：安全前置条件

当前 v5.5 的 public.records 允许用户对自己的行进行常规读写；现有 work_sessions / sync_work_session 也接收客户端提供的开始时间和 payload。因此，现有记录本身不能单独证明一段工作时长真实可信。

不能仅凭客户端提交的 records 行直接发放可刷取的游戏奖励。

正式接入真实工作奖励前，需要新增受服务端时间约束的工作证明流程：
- 服务端记录开始事件和 server_started_at。
- 服务端记录结束事件和 server_ended_at。
- 校验同一账号不能并行开启多个有效工作证明。
- 按服务端时间差、异常/中断规则计算可奖励时长。
- game_work_reward_claims 对 (user_id, verified_work_session_id) 建唯一约束。
- 奖励与证明消费在同一数据库事务中完成。

此改造单独评审，不修改现有工资和账本计算规则。未完成前，真实工时奖励保持关闭。

## 7. 版本实施顺序

1. 仓库与迁移基线核对；先解决 Supabase 线上 9 条 migration 历史与当前仓库迁移目录文件数不一致的问题。
2. 创建独立 game_ 数据库迁移，先建核心表、RLS、索引、目录和初始化/读取 RPC。
3. 建立 cat-game v2 页面，复用现有登录会话，不再读写 catGameDemo localStorage。
4. 实现钱包账本、库存、工作订单、任务和家园基础。
5. 实现矿洞、装备、服务端自动战斗与Boss。
6. 实现好友、主页、家园访问和排行榜。
7. 最后开发真实工时服务端证明与奖励联动。
8. 在 feature 分支验收，先内测入口，再由独立 PR 合并；不得直接覆盖正式 v5.4 或未经验证地改动 v5.5。

## 8. 验收清单

- 同账号两台设备看到相同云端等级、金币、库存、装备和家园。
- 两设备同时购买时不会透支或重复扣款。
- 重放同一个幂等请求不会重复领奖。
- 客户端篡改本地 JS/请求参数不能增加金币、物品、经验或战斗掉落。
- 普通玩家不能读取/修改其他玩家私有存档。
- 好友只能访问对方明确公开的资料和家园展示数据。
- 断网时不能提交变更；恢复联网后拉取最新快照。
- 原工时记录、工资、账本、管理员代录、现有同步功能全部回归测试通过。
- 真实工时奖励在可信服务端证明上线前保持关闭。
