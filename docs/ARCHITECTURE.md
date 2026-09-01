# Architecture

## 核心模型

本仓库采用“**双 marketplace、单一快照**”模型：

```text
GitHub upstream
      |
      v
sources/plugins.sources.yaml
      |
      v
pluginctl -> plugins/<name> -> Codex marketplace
      |               `----> Claude marketplace
      v
.xan/plugins.lock.json
```

`sources` 表达维护意图，`lock` 记录一次可复现同步的结果，`plugins` 是实际运行内容，
marketplace 只是平台发现层。任何一层不一致，`pluginctl check` 都会失败。

## 信任边界

第三方插件具有代码执行能力。同步时自动检查结构和完整性，但自动检查不能替代审查。
以下变化会在 lockfile 中标记为 review required：hooks、MCP 组件、可执行脚本、网络访问、
包安装、破坏性命令和敏感路径相关内容。

外部快照不允许手改。小改动写入 `overlays/<name>/overlay.yaml`，让每次更新都能重放；
大型分叉应改为自有 fork，并更新 source。

## 平台兼容契约

- `platforms: [codex]` 要求 `.codex-plugin/plugin.json`。
- `platforms: [claude]` 要求 `.claude-plugin/plugin.json`。
- manifest 名称必须与 source 名称一致；双平台名称和版本必须一致。
- marketplace 文件由 `pluginctl` 生成，禁止手改。
- 插件可同时包含 skills、hooks、MCP servers、commands 等平台支持的组件。

## 更新与发布

维护者先 dry-run，再同步和审查，最后运行所有检查。自动工作流可以发现并提交更新，
但风险标记发生变化时仍需要代码审查。仓库提交与 push 属于发布行为，不由工具默认执行。
