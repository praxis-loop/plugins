# Plugin overlays

第三方插件快照禁止直接修改。少量本地适配放在：

```text
overlays/<plugin-name>/overlay.yaml
```

格式：

```yaml
replace:
  - file: README.md
    from: old text
    to: new text
```

大型修改应 fork 上游并在 `sources/plugins.sources.yaml` 中切换来源。
