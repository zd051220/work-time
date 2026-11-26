# 自动版本管理核心

## 当前生产基线

当前 `version.json` 仍为 `{"version":"5.5","url":"v5.5.html","note":"当前正式版"}`。核心工具只在比较时把 `5.5` 兼容映射为 `5.5.0`；不修改生产配置、不创建 Tag，也不追溯宣称曾发布 `v5.5.0`。

## SemVer

`.github/scripts/versioning.cjs` 实现 SemVer 2.0.0 严格解析与优先级比较：数值段前导零校验、预发布标识符数字/文本优先级、标识符长度优先级，以及忽略 build metadata。超长数字预发布标识符使用 BigInt，避免精度丢失。

## PR 标签驱动递增

每个 PR 最多设置一个版本标签：

| 标签 | 结果 |
| --- | --- |
| `release:major` | 主版本 +1，次版本和修订版本归零 |
| `release:minor` | 次版本 +1，修订版本归零 |
| `release:patch` | 修订版本 +1 |
| `release:none` 或无版本标签 | 不产生版本 |

没有标签时不擅自推断 PATCH。冲突标签会让计算失败。PR 维护者应在审查期间明确选择标签。

## 运行时配置校验

配置校验接受完整三段式 SemVer 和当前两段式旧格式；检查 version、url、note。URL 必须是站点内安全相对 `.html` 路径，拒绝协议、根路径、路径穿越、查询参数和片段。本阶段不改动 `version.json` 或页面入口。

## 本地运行

```sh
node --test .github/scripts/versioning.test.cjs
node .github/scripts/versioning.cjs check-config version.json
node .github/scripts/versioning.cjs next 5.5 release:minor
```

仅使用 Node.js 内置模块，不增加第三方依赖。
