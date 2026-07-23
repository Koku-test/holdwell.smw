/**
 * 生成站点健康巡检系统使用说明书 (Word)
 */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, ShadingType, TableLayoutType, convertInchesToTwip,
} = require('docx');

const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'docs', '站点健康巡检系统-使用说明书.docx');

function p(text, opts = {}) {
  return new Paragraph({ spacing: { after: 120, line: 360 }, ...opts, children: [new TextRun({ text, size: 22, font: 'Microsoft YaHei', ...opts.run })] });
}
function heading(text, level) {
  return new Paragraph({ heading: level, spacing: { before: level === HeadingLevel.HEADING_1 ? 400 : 240, after: 160 }, children: [new TextRun({ text, bold: true, font: 'Microsoft YaHei', size: level === HeadingLevel.HEADING_1 ? 36 : 28 })], });
}
function bullet(text, level = 0) {
  return new Paragraph({ bullet: { level }, spacing: { after: 80, line: 340 }, children: [new TextRun({ text, size: 22, font: 'Microsoft YaHei' })] });
}
function boldP(label, value) {
  return new Paragraph({ spacing: { after: 80, line: 340 }, children: [new TextRun({ text: label, bold: true, size: 22, font: 'Microsoft YaHei' }), new TextRun({ text: value, size: 22, font: 'Microsoft YaHei' })], });
}
function cell(text, opts = {}) {
  return new TableCell({ width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined, shading: opts.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined, children: [new Paragraph({ spacing: { after: 40, before: 40 }, children: [new TextRun({ text, size: opts.fontSize || 20, font: 'Microsoft YaHei', bold: opts.bold || false, color: opts.color || '333333' })], })], });
}
function hCell(text, w) { return cell(text, { bold: true, width: w, shading: '1a1a2e', color: 'ffffff', fontSize: 20 }); }
function makeTable(headers, rows, widths) {
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.FIXED, rows: [new TableRow({ tableHeader: true, children: headers.map((h, i) => hCell(h, widths ? widths[i] : undefined)) }), ...rows.map(r => new TableRow({ children: r.map((c, i) => cell(c, { width: widths ? widths[i] : undefined })) }))], });
}

const doc = new Document({
  styles: { default: { document: { run: { font: 'Microsoft YaHei', size: 22 } } } },
  sections: [{
    properties: { page: { margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1.2), right: convertInchesToTwip(1.2) } } },
    children: [
      // 封面
      new Paragraph({ spacing: { before: 2400 }, children: [] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: '站点健康巡检系统', size: 56, bold: true, font: 'Microsoft YaHei', color: '1a1a2e' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 }, children: [new TextRun({ text: '使用说明书 v2.0', size: 40, font: 'Microsoft YaHei', color: '666666' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [new TextRun({ text: 'Holdwell 站点群 · 7 项自动化检测 · 双频执行 · 钉钉告警', size: 24, font: 'Microsoft YaHei', color: '999999' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [new TextRun({ text: '2026 年 7 月', size: 22, font: 'Microsoft YaHei', color: '999999' })] }),

      new Paragraph({ children: [], pageBreakBefore: true }),

      // 一、系统简介
      heading('一、系统简介', HeadingLevel.HEADING_1),
      p('本系统自动监控 Holdwell 旗下 8 个站点的健康状态，涵盖连通性、安全性、性能、移动端适配等 7 个维度。'),
      p('检测分为两个阶段独立运行，频率不同，结果合并展示。Phase 1 异常自动通过钉钉群发送告警并 @ 对应负责人，Phase 2 问题仅在看台预警。'),
      boldP('监控站点：', '品牌站、中文集团站、品牌在线成交站、非品牌在线成交站、单一类目在线成交站、高空车整机站、资讯站、美国项目站'),
      boldP('运行平台：', 'GitHub Actions（全自动，无需服务器）'),
      boldP('看台地址：', 'https://koku-test.github.io/holdwell.smw/dashboard/'),

      // 二、检测项清单
      heading('二、检测项清单', HeadingLevel.HEADING_2),
      p('系统共 7 项检测，分为 Phase 1（基础）和 Phase 2（浏览器）两个阶段：'),
      makeTable(
        ['阶段', '检测项', '检测方式', '频率', '异常处理'],
        [
          ['Phase 1', 'HTTP 可达性', 'HTTP GET 请求', '每 4 天', '钉钉告警 @负责人'],
          ['Phase 1', 'SSL 证书', 'TLS 握手检查有效期', '每 4 天', '钉钉告警 @负责人'],
          ['Phase 1', 'DNS 配置', '双路 DNS 解析', '每 4 天', '钉钉告警 @负责人'],
          ['Phase 1', '端口连通', 'TCP 端口探测', '每 4 天', '钉钉告警 @负责人'],
          ['Phase 1', '响应时间', 'HTTP 延迟', '每 4 天', '>3s 钉钉告警'],
          ['Phase 2', 'CDN 回源', 'Puppeteer 网络拦截', '每 7 天', '仅看板预警'],
          ['Phase 2', '页面性能', 'Lighthouse 评分', '每 7 天', '仅看板预警'],
          ['Phase 2', '移动端适配', '400×738 视口检查', '每 7 天', '仅看板预警'],
          ['Phase 2', '安全响应头', 'HSTS/CSP 等 6 项', '每 4 天', '仅看板预警'],
        ],
        [12, 20, 28, 14, 26]
      ),

      // 三、完整流程
      heading('三、完整流程', HeadingLevel.HEADING_2),
      p(''),
      p('以下为系统从触发到结束的完整链路：'),
      p(''),

      boldP('1. 定时 / 手动触发', ''),
      bullet('Phase 1：每 4 天自动触发一次（每月 1、5、9、13、17、21、25、29 日 10:00）'),
      bullet('Phase 2：每 7 天自动触发一次（每周日 10:00，与当天 Phase 1 同时执行）'),
      bullet('手动触发：看台 🔄 按钮 → 任选基础/浏览器/全部检测'),
      p(''),

      boldP('2. 执行检测', ''),
      bullet('Phase 1：HTTP 请求 → SSL 握手 → DNS 解析 → TCP 端口 → 安全响应头'),
      bullet('Phase 2：启动 Chrome → Lighthouse 手机/电脑 → Puppeteer CDN 拦截 → 移动端视口检查'),
      bullet('Phase 2 执行时保留 Phase 1 上次结果，反之亦然'),
      p(''),

      boldP('3. 异常判定', ''),
      bullet('Phase 1 有 fail → 整体状态 ❌ 异常 → 钉钉推送 @负责人'),
      bullet('Phase 1 正常 + Phase 2 有 fail/warn → 整体状态 ⚠️ 警告 → 仅看板预警，不推送'),
      bullet('全部正常 → ✅ 正常'),
      p(''),

      boldP('4. 结果输出', ''),
      bullet('写入 dashboard/data.json，自动提交到 GitHub'),
      bullet('GitHub Pages 自动部署，看台实时刷新'),
      p(''),

      // 四、执行频率
      heading('四、执行频率时间线', HeadingLevel.HEADING_2),
      p(''),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: '每月 1 日 —— 5 日 —— 9 日 —— 13 日 —— 17 日 —— 21 日 —— 25 日 —— 29 日', size: 20, font: 'Microsoft YaHei', color: '666666' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: 'Phase 1     Phase 1     Phase 1     Phase 1     Phase 1     Phase 1     Phase 1     Phase 1', size: 20, bold: true, font: 'Microsoft YaHei' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: '▲ 周日叠加 Phase 2（浏览器检测）', size: 20, font: 'Microsoft YaHei', color: 'e74c3c' })] }),
      makeTable(
        ['检测类型', '频率', '触发时间', '内容'],
        [
          ['Phase 1 基础', '每 4 天', '10:00 北京时间', 'HTTP/SSL/DNS/端口/响应时间'],
          ['Phase 2 浏览器', '每 7 天（周日）', '10:00 北京时间', 'Lighthouse/CDN/移动端/安全'],
        ],
        [22, 20, 28, 30]
      ),

      // 五、钉钉告警
      heading('五、钉钉告警通知', HeadingLevel.HEADING_2),
      p('Phase 1 检测到异常时，自动向钉钉群发送消息并 @ 对应负责人。Phase 2 问题仅在看台预警，不推送。'),
      boldP('消息格式：', ''),
      p('  ❌ @15962976787，https://www.holdwell.net/ HTTP可达性timeout，请知悉并及时协调运维侧进行处理~'),
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
      boldP('通知逻辑：', '每跑完一个站点立即判断，Phase 1 异常立即推送，不等待全部跑完。'),

      // 六、看台
      heading('六、健康看台', HeadingLevel.HEADING_2),
      p('看台是一个静态网页，浏览器打开即可查看所有站点状态。'),
      bullet('顶部汇总栏：正常/警告/异常数量 + Phase 1/Phase 2 各自最新检测时间'),
      bullet('筛选标签：按状态筛选站点卡片'),
      bullet('站点卡片：每站一张卡片，展示所有检测项'),
      bullet('卡片颜色：红色边框 = Phase 1 异常，黄色边框 = 警告，绿色 = 正常'),
      bullet('Phase 2 预警：卡片出现黄色边框光环，表示 Phase 2 检测项有问题'),
      bullet('测速显示：正常显示 ✅，低于阈值时显示分数'),
      bullet('🔄 按钮：手动触发单站点检测'),
      p(''),
      boldP('看台地址：', 'https://koku-test.github.io/holdwell.smw/dashboard/'),

      // 七、配置
      heading('七、配置说明', HeadingLevel.HEADING_2),
      p('所有配置在 sites-config.json 中，修改后推送到 GitHub 即生效。'),
      boldP('全局配置：', ''),
      bullet('timeoutMs: 请求超时（毫秒），默认 8000'),
      bullet('concurrency: 并发数，默认 2'),
      bullet('dingtalk.webhook: 钉钉机器人 Webhook 地址'),
      bullet('dingtalk.signKey: 钉钉加签密钥'),
      p(''),
      boldP('站点配置：', ''),
      bullet('name / url: 站点名称和地址'),
      bullet('owner / dingtalkMobiles: 负责人名称和手机号'),
      bullet('checkPagespeed / checkCdn / checkMobileAdapt / checkSecurity: 开关各项检测'),

      // 八、增删站点
      heading('八、增删站点', HeadingLevel.HEADING_2),
      p('在 sites-config.json 的 sites 数组中添加或删除即可，推送到 GitHub 后下次检测自动生效。'),
      p(''),
      p('{\n  "name": "新站点",\n  "url": "https://www.example.com/",\n  "owner": "@负责人",\n  "dingtalkMobiles": ["138xxxx1234"],\n  "checkPagespeed": true,\n  "checkCdn": true,\n  "checkMobileAdapt": true,\n  "checkSecurity": true\n}', { run: { size: 18 } }),

      // 九、FAQ
      heading('九、常见问题', HeadingLevel.HEADING_2),
      boldP('Q: 为什么基础检测和浏览器检测频率不同？', ''),
      p('A: 基础检测（HTTP/SSL/DNS）轻量快速，适合高频。浏览器检测需启动 Chrome，耗时较长。'),
      boldP('Q: Phase 2 问题为什么不推送钉钉？', ''),
      p('A: Phase 2（性能/CDN/移动端）属于优化级别，不是紧急故障，仅在看台预警，避免频繁打扰。'),
      boldP('Q: 看台显示黄色但没人收到消息？', ''),
      p('A: 黄色 = Phase 2 预警，不会推送钉钉。只有红色（Phase 1 异常）才会推送。'),
      boldP('Q: 手动检测会不会覆盖定时检测？', ''),
      p('A: 手动检测独立运行，结果写入同一个 data.json，不影响定时任务计划。'),
    ],
  }],
});

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(OUT_FILE, buffer);
  console.log('✅ 说明书已生成:', OUT_FILE, (buffer.length / 1024).toFixed(1) + 'KB');
}).catch(err => { console.error('❌', err.message); process.exit(1); });