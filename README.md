# Praxis Plugins

面向 **Claude Code** 与 **Codex / ChatGPT** 的跨平台插件仓库。仓库保存经过审核的运行时快照，来源声明、精确锁定、
完整性校验和本地适配彼此分离。

## 当前插件

| 插件 | 上游 | Claude | Codex | 说明 |
| --- | --- | :---: | :---: | --- |
| Ponytail | `DietrichGebert/ponytail` | ✓ | ✓ | 把 AI 编程会话整理为可复用的轨迹、记忆和洞察 |
| Sepia | `Nanako0129/sepia` | ✓ | ✓ | 去 AI 味写作：router 加 write / review / refactor / recreate 四个操作入口 |
| ECC | `affaan-m/ECC` | ✓ | ✓ | agent harness 优化系统：agents、skills、命令、hooks、规则与 MCP 约定 |

三者都是第三方插件；`plugins/<name>/` 是由 `pluginctl` 从上游生成的快照，
不要直接编辑。

## 目录约定

```text
plugins/<name>/                    # 审核后的完整插件快照
sources/plugins.sources.yaml       # 上游来源和支持平台
.xan/plugins.lock.json             # commit/tree/content hash 与风险标记
overlays/<name>/overlay.yaml       # 可重放的小型本地适配
.agents/plugins/marketplace.json   # Codex marketplace（生成文件）
.claude-plugin/marketplace.json    # Claude marketplace（生成文件）
tools/pluginctl                    # 供应链工具
```

两个 marketplace 指向同一份 `plugins/<name>/` 快照，因此不会为 Claude 和 Codex
维护两份容易漂移的副本。插件内部仍保留各自的
`.claude-plugin/plugin.json` 和 `.codex-plugin/plugin.json`。

## 使用

先安装维护依赖并检查仓库：

```bash
npm ci
node tools/pluginctl check
bash scripts/doctor.sh
```

Windows 没有可用 Bash/WSL 时，等价运行
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/doctor.ps1`。

注册本地 marketplace：

```bash
# Claude Code
claude plugin marketplace add /absolute/path/to/praxis-plugins
claude plugin install ponytail@praxis-plugins
claude plugin install sepia@praxis-plugins
claude plugin install ecc@praxis-plugins

# Codex
codex plugin marketplace add /absolute/path/to/praxis-plugins
```

如果当前 `codex help plugin` 提示不支持该子命令，请使用 Codex 桌面的插件页或仓库
README 交付信息中的 `codex://` 安装链接；这是 CLI 版本能力差异，不影响 marketplace 结构。

也可以运行 `bash scripts/install.sh`；Windows PowerShell 使用
`./scripts/install.ps1`。脚本只注册 marketplace，不会静默安装插件。

## 更新第三方插件

```bash
node tools/pluginctl update ponytail --dry-run
node tools/pluginctl update ponytail
npm test
node tools/pluginctl check
bash scripts/doctor.sh
git diff -- plugins/ponytail .xan/plugins.lock.json
```

更新会解析上游分支，保存精确 commit 与 tree SHA，复制完整快照，应用 overlay，
校验双平台 manifest，计算稳定的 SHA-256，并重新生成两个 marketplace。
出现 hooks、MCP、可执行脚本、联网/安装命令、破坏性命令或敏感路径提示时，
必须人工审查 diff 后再提交。

新增来源示例：

```bash
node tools/pluginctl add github owner/repository --name example --platforms claude,codex
node tools/pluginctl update example
```

更多设计细节见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
