/**
 * 生成站点健康巡检系统使用说明书 (Word)
 * 输出: docs/站点健康巡检系统-使用说明书.docx
 */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, BorderStyle, ShadingType,
  TableLayoutType, convertInchesToTwip,
} = require('docx');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs');
const OUT_FILE = path.join(OUT_DIR, '站点健康巡检系统-使用说明书.docx');

// ========== Helpers ==========
function p(text, options = {}) {
  return new Paragraph({
    spacing: { after: 120, line: 360 },
    ...options,
    children: typeof text === 'string'
      ? [new TextRun({ text, size: 22, font: 'Microsoft YaHei', ...options.run })]
      : text,
  });
}

function heading(text, level) {
  return new Paragraph({
    heading: level,
    spacing: { before: level === HeadingLevel.HEADING_1 ? 400 : 240, after: 160 },
    children: [new TextRun({ text, bold: true, font: 'Microsoft YaHei', size: level === HeadingLevel.HEADING_1 ? 36 : level === HeadingLevel.HEADING_2 ? 28 : 24 })],
  });
}

function bullet(text, options = {}) {
  return new Paragraph({
    bullet: { level: options.level || 0 },
    spacing: { after: 80, line: 340 },
    children: [new TextRun({ text, size: 22, font: 'Microsoft YaHei' })],
  });
}

function boldP(label, value) {
  return new Paragraph({
    spacing: { after: 80, line: 340 },
    children: [
      new TextRun({ text: label, bold: true, size: 22, font: 'Microsoft YaHei' }),
      new TextRun({ text: value, size: 22, font: 'Microsoft YaHei' }),
    ],
  });
}

function cell(text, options = {}) {
  return new TableCell({
    width: options.width ? { size: options.width, type: WidthType.PERCENTAGE } : undefined,
    shading: options.shading ? { fill: options.shading, type: ShadingType.CLEAR } : undefined,
    children: [new Paragraph({
      spacing: { after: 40, before: 40 },
      children: [new TextRun({ text, size: options.fontSize || 20, font: 'Microsoft YaHei', bold: options.bold || false, color: options.color || '333333' })],
    })],
  });
}

function headerCell(text, width) {
  return cell(text, { bold: true, width, shading: '1a1a2e', color: 'ffffff', fontSize: 20 });
}

function makeTable(headers, rows, colWidths) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => headerCell(h, colWidths ? colWidths[i] : undefined)),
  });
  const dataRows = rows.map(row =>
    new TableRow({
      children: row.map((c, i) => cell(c, { width: colWidths ? colWidths[i] : undefined })),
    })
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [headerRow, ...dataRows],
  });
}

// ========== Document Content ==========
const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: 'Microsoft YaHei', size: 22 },
      },
    },
  },
  sections: [{
    properties: {
      page: {
        margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1.2), right: convertInchesToTwip(1.2) },
      },
    },
    children: [
      // ========== 封面 ==========
      new Paragraph({ spacing: { before: 2400 }, children: [] }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [new TextRun({ text: '站点健康巡检系统', size: 56, bold: true, font: 'Microsoft YaHei', color: '1a1a2e' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 600 },
        children: [new TextRun({ text: '使用说明书', size: 40, font: 'Microsoft YaHei', color: '666666' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [new TextRun({ text: 'Holdwell 站点群 · 7 项自动化检测 · 钉钉即时告警', size: 24, font: 'Microsoft YaHei', color: '999999' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
        children: [new TextRun({ text: '2026 年 7 月 · v1.0', size: 22, font: 'Microsoft YaHei', color: '999999' })],
      }),

      // ========== 分页 ==========
      new Paragraph({ children: [], pageBreakBefore: true }),

      // ========== 一、系统简介 ==========
      heading('一、系统简介', HeadingLevel.HEADING_1),
      p('本系统用于自动监控 Holdwell 旗下 8 个站点的健康状态，涵盖连通性、安全性、性能、移动端适配等 7 个维度。检测到异常时自动通过钉钉群发送告警，并 @ 对应负责人。'),
      p(''),
      boldP('监控站点：', '品牌站、中文集团站、品牌在线成交站、非品牌在线成交站、单一类目在线成交站、高空车整机站、资讯站、美国项目站'),
      boldP('运行平台：', 'GitHub Actions（全自动，无需服务器）'),
      boldP('看台地址：', 'https://<user>.github.io/<repo>/dashboard/'),

      // ========== 二、检测项清单 ==========
      heading('二、检测项清单', HeadingLevel.HEADING_2),
      p('系统共包含 7 项自动化检测，分为两个阶段执行：'),
      p(''),
      makeTable(
        ['序号', '检测项', '检测内容', '频率', '告警条件'],
        [
          ['1', '站点可达性', 'HTTP + DNS + TCP 端口', '每 4 天', '无法访问即告警'],
          ['2', 'SSL 证书', 'TLS 握手检查有效期', '每 4 天', '剩余 ≤ 7 天'],
          ['3', 'DNS 配置', '双路 DNS 解析', '每 4 天', '解析失败'],
          ['4', '安全响应头', 'HSTS/CSP/X-Frame 等', '每 4 天', '缺少任一项'],
          ['5', '页面性能', 'Lighthouse 评分', '每 7 天', '手机 < 70 / 电脑 < 90'],
          ['6', 'CDN 回源', 'Puppeteer 网络拦截', '每 7 天', '资源 4xx/5xx'],
          ['7', '移动端适配', '400×738 视口检查', '每 7 天', '溢出/小字/小触控'],
        ],
        [8, 16, 26, 14, 36]
      ),
      p(''),
      boldP('说明：', '第 1-4 项为"基础检测"，轻量快速，每 4 天执行一次。第 5-7 项为"浏览器检测"，需要启动 Chrome，每 7 天执行一次。两项检测结果合并展示，互不覆盖。'),

      // ========== 三、执行频率 ==========
      heading('三、执行频率', HeadingLevel.HEADING_2),
      p('系统按以下时间线自动运行，无需人工干预：'),
      p(''),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [
          new TextRun({ text: '每月 1 日 ─── 5 日 ─── 9 日 ─── 13 日 ─── 17 日 ─── 21 日 ─── 25 日 ─── 29 日', size: 20, font: 'Microsoft YaHei', color: '666666' }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [
          new TextRun({ text: '  基础检测    基础检测    基础检测    基础检测    基础检测    基础检测    基础检测    基础检测', size: 20, font: 'Microsoft YaHei', bold: true }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [
          new TextRun({ text: '                                                                                        ▲ 周日叠加浏览器检测', size: 20, font: 'Microsoft YaHei', color: 'e74c3c' }),
        ],
      }),
      p(''),
      makeTable(
        ['检测类型', '频率', '触发时间（北京时间）', '触发方式'],
        [
          ['基础检测 (Phase 1)', '每 4 天', '上午 10:00', 'GitHub Actions 定时'],
          ['浏览器检测 (Phase 2)', '每 7 天（周日）', '上午 10:00', 'GitHub Actions 定时'],
          ['手动触发', '随时', '即时', '看台按钮 / 命令行'],
        ],
        [22, 20, 28, 30]
      ),

      // ========== 四、钉钉通知 ==========
      heading('四、钉钉告警通知', HeadingLevel.HEADING_2),
      p('检测到异常时，系统自动向钉钉群"站点健康警报处理"发送消息，并 @ 对应负责人。'),
      p(''),
      boldP('消息格式：', ''),
      p('  ❌ @15962976787，https://www.holdwell.net/ HTTP可达性timeout、SSL证书剩余3天，请知悉并及时协调运维侧进行处理~'),
      p(''),
      makeTable(
        ['站点', '负责人', '通知手机号'],
        [
          ['品牌站', '@王雨航(koku)', '15962976787'],
          ['中文集团站', '@陈俊 @王雨航(koku)', '15067893750, 15962976787'],
          ['品牌在线成交站', '@王雨航(koku)', '15962976787'],
          ['非品牌在线成交站', '@黄开发(Oliver Huang)', '18616749320'],
          ['单一类目在线成交站', '@郭娟(JaneGuo)', '18667142620'],
          ['高空车整机站', '@魏卓青(Zoya Wei)', '17857578339'],
          ['资讯站', '@郝建凯', '18638569220'],
          ['美国项目站', '@杨续立', '15236186966'],
        ],
        [28, 36, 36]
      ),
      p(''),
      boldP('通知逻辑：', '每跑完一个站点立即判断，异常则立刻发消息，不等待全部跑完。健康站点不发送。'),

      // ========== 五、看台使用 ==========
      heading('五、健康看台使用', HeadingLevel.HEADING_2),
      p('看台是一个静态网页，浏览器直接打开即可查看所有站点状态。'),
      p(''),
      bullet('顶部汇总栏：显示正常/警告/异常站点数量，以及基础检测和浏览器检测各自的最新时间'),
      bullet('筛选标签：可按"全部 / 正常 / 警告 / 异常"筛选站点卡片'),
      bullet('站点卡片：每个站点一张卡片，展示所有检测项状态'),
      bullet('点击"查看详情"：展开显示每项检测的详细数据'),
      bullet('🔄 按钮：手动触发单个站点检测（基础 / 浏览器 / 全部 三种模式任选）'),
      p(''),
      boldP('手动触发步骤：', ''),
      bullet('点击站点卡片右上角 🔄 按钮', 1),
      bullet('选择"基础检测"、"浏览器检测"或"全部检测"', 1),
      bullet('系统自动打开 GitHub Actions 页面', 1),
      bullet('点击 "Run workflow" → 确认 Mode 和 Site → 点击绿色按钮执行', 1),
      boldP('注意：', '手动触发独立于定时任务，互不影响。'),

      // ========== 六、配置说明 ==========
      heading('六、配置说明', HeadingLevel.HEADING_2),
      p('所有配置集中在 sites-config.json 文件中，修改后推送到 GitHub 即可生效。'),
      p(''),
      boldP('全局配置：', ''),
      bullet('timeoutMs: 请求超时时间（毫秒），默认 8000'),
      bullet('concurrency: 并发检测数，默认 2'),
      bullet('dnsResolvers: 备用 DNS 服务器'),
      bullet('dingtalk.webhook: 钉钉机器人 Webhook 地址'),
      bullet('dingtalk.signKey: 钉钉机器人加签密钥'),
      p(''),
      boldP('站点配置（每个站点）：', ''),
      bullet('name / url: 站点名称和地址'),
      bullet('owner: 负责人显示名称'),
      bullet('dingtalkMobiles: 负责人手机号数组（用于 @ 提醒）'),
      bullet('expectStatus: 期望 HTTP 状态码，默认 200'),
      bullet('checkPorts: 要检测的端口列表'),
      bullet('checkDns / checkSsl / checkPagespeed / checkCdn / checkMobileAdapt / checkSecurity: 开关各项检测'),

      // ========== 七、增加新站点 ==========
      heading('七、增加新站点', HeadingLevel.HEADING_2),
      p('在 sites-config.json 的 sites 数组中添加一项即可：'),
      p(''),
      p('{\n  "name": "新站点",\n  "url": "https://www.example.com/",\n  "owner": "@负责人",\n  "dingtalkMobiles": ["138xxxx1234"],\n  "expectStatus": 200,\n  "checkPorts": [80, 443],\n  "checkDns": true,\n  "checkSsl": true,\n  "checkPagespeed": true,\n  "checkCdn": true,\n  "checkMobileAdapt": true,\n  "checkSecurity": true\n}', { run: { size: 18 } }),
      p(''),
      p('保存后推送到 GitHub，下一次定时检测自动纳入。'),

      // ========== 八、常见问题 ==========
      heading('八、常见问题', HeadingLevel.HEADING_2),
      p(''),
      boldP('Q: 为什么基础检测和浏览器检测频率不同？', ''),
      p('A: 基础检测（HTTP/SSL/DNS）轻量快速，适合高频监控。浏览器检测需要启动 Chrome 加载完整页面，耗时较长，每周一次足够。'),
      p(''),
      boldP('Q: 浏览器检测当周没跑，看台会显示什么？', ''),
      p('A: 看台会保留上一次浏览器检测的结果，标记来源时间。基础检测结果始终是最新的。'),
      p(''),
      boldP('Q: 手动检测会不会覆盖定时检测的结果？', ''),
      p('A: 手动检测独立运行，结果写入同一个 data.json，但不会影响定时任务的执行计划。'),
      p(''),
      boldP('Q: 如何修改钉钉通知内容？', ''),
      p('A: 编辑 scripts/site-health-check.js 中的 sendDingtalkPerSite 函数，修改 text 变量即可。'),
    ],
  }],
});

// ========== Generate ==========
fs.mkdirSync(OUT_DIR, { recursive: true });
Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(OUT_FILE, buffer);
  console.log(`✅ 使用说明书已生成: ${OUT_FILE}`);
  console.log(`   大小: ${(buffer.length / 1024).toFixed(1)} KB`);
}).catch(err => {
  console.error('❌ 生成失败:', err.message);
  process.exit(1);
});