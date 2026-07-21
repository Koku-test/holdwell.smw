# 🏥 站点健康看台

基于 GitHub Actions + Pages 的站点运维自动巡检面板。

## 工作流

```
GitHub Actions (定时/手动触发)
  └→ node scripts/site-health-check.js
      └→ 生成 dashboard/data.json
          └→ 自动提交 + 推送
              └→ GitHub Pages 自动部署
                  └→ 打开看台即可查看最新数据
```

## 使用

### 1. Fork / Clone 本仓库

```bash
git clone https://github.com/<你的用户名>/site-health-dashboard.git
cd site-health-dashboard
```

### 2. 配置站点

编辑 `sites-config.json`，在里面添加你想监控的站点：

```json
{
  "sites": [
    {
      "name": "我的站点",
      "url": "https://example.com",
      "checkPagespeed": true
    }
  ],
  "global": {
    "pagespeedApiKey": "YOUR_PAGESPEED_API_KEY"
  }
}
```

### 3. 启用 GitHub Pages

Settings → Pages → Source: `Deploy from branch` → `main` → `/` (root) → Save

### 4. 添加 Secrets（可选，用于 PageSpeed）

Settings → Secrets and variables → Actions → `PAGESPEED_API_KEY`

### 5. 看台地址

`https://<你的用户名>.github.io/<仓库名>/dashboard/`

### 6. 首次手动触发

Actions → 站点健康巡检 → Run workflow

之后每天 10:00 (北京时间) 自动巡检一次，有新数据自动更新看台。

## 检查项

| # | 问题 | 状态 | 说明 |
|---|------|------|------|
| 1 | 站点无法访问 | ✅ | HTTP/DNS/TCP 48h 巡检，连续 3 次失败，第 2 次告警 |
| 2 | SSL 证书过期 | ✅ | 剩余天数记录，≤7 天告警 |
| 3 | DNS 配置异常 | ✅ | 挂在 #1 下，异常判定同 #1 |
| 5 | 页面加载超慢 | ✅ | HTTP 响应时间 + PageSpeed Insights（手机 <70 / 电脑 <90） |
| 4 | CDN 回源失败 | ⏳ | 待 Puppeteer 集成 |
| 8 | 移动端适配 | ⏳ | 待 Puppeteer 400×738 截图 + vision 分析 |
| 9 | 安全漏洞 | ⏳ | 待 Snyk 每周扫描（高危告警） |

## 本地调试

```bash
# 运行巡检脚本
node scripts/site-health-check.js

# 打开看台
open dashboard/index.html  # 或直接双击
```

## 架构

```
.
├── sites-config.json              ← 站点配置
├── .github/workflows/
│   └── health-check.yml           ← 定时巡检工作流
├── scripts/
│   ├── site-health-check.js       ← 核心巡检引擎
│   └── cron-health-check.js       ← Cron 包装器（本地用）
├── dashboard/
│   ├── index.html                 ← 看台前端
│   └── data.json                  ← 巡检数据（自动生成）
└── README.md
```
