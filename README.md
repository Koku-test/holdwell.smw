# 🏥 站点健康看台

Holdwell 站点群自动化巡检面板 — 7 项检测 + 双频执行 + 钉钉即时告警。

## 工作流

```
GitHub Actions (定时/手动触发)
  ├── Phase 1 (每 4 天): 基础检测
  │     HTTP / SSL / DNS / 端口 / 安全响应头
  └── Phase 2 (每 7 天): 浏览器检测
        Lighthouse 性能 / CDN 回源 / 移动端适配
            └→ 生成 dashboard/data.json
                └→ 自动提交 + 推送
                    └→ GitHub Pages 自动部署
                        └→ 异常 → 钉钉群 @ 负责人
```

## 检查项

| # | 检查项 | 频率 | 工具 |
|---|--------|------|------|
| 1 | 站点可达性 | 每 4 天 | HTTP + DNS + TCP |
| 2 | SSL 证书 | 每 4 天 | TLS 握手 |
| 3 | DNS 配置 | 每 4 天 | 双路 DNS 解析 |
| 4 | 安全响应头 | 每 4 天 | HSTS/CSP 等 6 项 |
| 5 | 页面性能 | 每 7 天 | Lighthouse 本地 |
| 6 | CDN 回源 | 每 7 天 | Puppeteer 网络拦截 |
| 7 | 移动端适配 | 每 7 天 | Puppeteer 400×738 |

## 使用

### 看台地址

`https://koku-test.github.io/holdwell.smw/dashboard/`

### 手动触发

- 看台每个站点卡片右上角 🔄 按钮 → 单站点检测
- GitHub Actions → 站点健康巡检 → Run workflow

### 配置

编辑 `sites-config.json`，每个站点支持：

```json
{
  "name": "站点名",
  "url": "https://...",
  "owner": "@负责人",
  "dingtalkMobiles": ["138xxxx1234"],
  "checkPagespeed": true,
  "checkCdn": true,
  "checkMobileAdapt": true,
  "checkSecurity": true
}
```

### 本地调试

```bash
node scripts/site-health-check.js              # 全部检测
node scripts/site-health-check.js --basic      # 仅基础检测
node scripts/site-health-check.js --browser    # 仅浏览器检测
node scripts/site-health-check.js --site=品牌站 # 单站点
```

## 架构

```
.
├── sites-config.json                 ← 站点配置
├── .github/workflows/
│   └── health-check.yml             ← 定时巡检工作流
├── scripts/
│   ├── site-health-check.js         ← 核心巡检引擎
│   └── generate-doc.js              ← 使用说明书生成器
├── dashboard/
│   ├── index.html                   ← 看台前端
│   └── data.json                    ← 巡检数据（自动生成）
├── docs/
│   └── 站点健康巡检系统-使用说明书.docx
└── README.md
```