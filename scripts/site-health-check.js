/**
 * 站点健康巡检 — 综合版
 * =====================
 * 输出: dashboard/data.json（供 HTML 看台读取）
 *
 * 运行模式:
 *   node scripts/site-health-check.js              → 全部检测（本地测试用）
 *   node scripts/site-health-check.js --basic      → Phase 1: 基础检查 (每96h)
 *   node scripts/site-health-check.js --browser    → Phase 2: 浏览器检测 (每7天)
 *
 * 合并逻辑:
 *   Phase 1 跑完写 data.json，保留上一次 Phase 2 的结果
 *   Phase 2 跑完写 data.json，保留上一次 Phase 1 的结果
 *
 * 检查项:
 *   ✅ 1. 站点无法访问 (HTTP/DNS/TCP) — 96h
 *   ✅ 2. SSL 证书过期 (≤7 天告警) — 96h
 *   ✅ 3. DNS 配置异常 — 96h
 *   ✅ 4. CDN 回源失败 (Puppeteer 网络拦截) — 7天
 *   ✅ 5. 页面加载超慢 (PageSpeed Insights API) — 7天
 *   ✅ 6. 移动端适配 (Puppeteer 400x738) — 7天
 *   ✅ 7. 安全响应头 (HSTS/CSP 等) — 96h
 *   ✅ 钉钉通知 — 异常时 @ 对应负责人
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');
const dns = require('dns');
const crypto = require('crypto');
const chromeLauncher = require('chrome-launcher');
const puppeteer = require('puppeteer-core');

// ============== Paths ==============
const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'sites-config.json');
const DATA_PATH = path.join(ROOT, 'dashboard', 'data.json');

// 修复 Windows 上临时文件权限问题
fs.mkdirSync(path.join(ROOT, '.tmp'), { recursive: true });
process.env.TMP = path.join(ROOT, '.tmp');
process.env.TEMP = path.join(ROOT, '.tmp');

// PageSpeed Insights API Key（从环境变量 PSI_API_KEY 读取，不配置则跳过 PSI 检测）
const PSI_API_KEY = process.env.PSI_API_KEY || null;

// ============== Utils ==============
function now() { return new Date().toISOString(); }
function nowCN() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function httpGet(url, timeoutMs, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const start = Date.now();
    const req = lib.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'SOMW-HealthCheck/1.0' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        const redirectUrl = new URL(res.headers.location, url).href;
        req.destroy();
        httpGet(redirectUrl, timeoutMs, maxRedirects - 1).then(r => {
          r.redirectedFrom = url;
          r.redirectedTo = redirectUrl;
          r.originalStatusCode = res.statusCode;
          resolve(r);
        }).catch(reject);
        return;
      }
      const elapsedMs = Date.now() - start;
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body, elapsedMs }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ============== Phase 1 Checks (基础) ==============

async function checkHttpReachability(url, expectStatus, timeoutMs) {
  const result = { status: 'ok', statusCode: null, elapsedMs: 0, error: null, details: {}, redirect: null };
  try {
    const res = await httpGet(url, timeoutMs);
    result.statusCode = res.statusCode;
    result.elapsedMs = res.elapsedMs;
    if (res.statusCode !== (expectStatus || 200)) {
      result.status = 'fail';
      result.error = `期望状态码 ${expectStatus || 200}，实际 ${res.statusCode}`;
    }
    result.body = res.body;
    if (res.elapsedMs > 8000) result.status = 'fail';
    else if (res.elapsedMs > 3000) { if (result.status === 'ok') result.status = 'warn'; }
    result.details = {
      server: res.headers['server'] || null,
      contentType: res.headers['content-type'] || null,
      location: res.headers['location'] || null,
    };
    if (res.redirectedFrom) {
      result.redirect = { from: res.redirectedFrom, to: res.redirectedTo, code: res.originalStatusCode };
      result.note = `${res.originalStatusCode} → ${res.redirectedTo}`;
    }
    return result;
  } catch (e) {
    result.status = 'fail';
    result.error = e.message;
    return result;
  }
}

function checkSsl(hostname, port, timeoutMs) {
  return new Promise((resolve) => {
    const result = { status: 'ok', daysLeft: 0, issuer: null, subject: null, validFrom: null, validTo: null, error: null };
    const start = Date.now();
    const socket = net.createConnection(port || 443, hostname);
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => {
      const tls = require('tls');
      const ts = tls.connect({ socket, host: hostname, servername: hostname, rejectUnauthorized: false });
      ts.on('secureConnect', () => {
        const cert = ts.getPeerCertificate();
        const now = new Date();
        const validTo = new Date(cert.valid_to);
        result.daysLeft = Math.floor((validTo - now) / (1000 * 60 * 60 * 24));
        result.issuer = (cert.issuer && (cert.issuer.O || cert.issuer.CN)) || 'unknown';
        result.subject = (cert.subject && cert.subject.CN) || 'unknown';
        result.validFrom = cert.valid_from;
        result.validTo = cert.valid_to;
        result.elapsedMs = Date.now() - start;
        if (result.daysLeft < 0) result.status = 'fail';
        else if (result.daysLeft <= 7) result.status = 'fail';
        else result.status = 'ok';
        ts.end(); socket.destroy();
        resolve(result);
      });
      ts.on('error', (e) => { socket.destroy(); result.status = 'fail'; result.error = e.message; resolve(result); });
      ts.on('timeout', () => { ts.end(); socket.destroy(); result.status = 'fail'; result.error = 'SSL handshake timeout'; resolve(result); });
    });
    socket.on('error', (e) => { result.status = 'fail'; result.error = `TCP: ${e.message}`; resolve(result); });
    socket.on('timeout', () => { socket.destroy(); result.status = 'fail'; result.error = 'TCP timeout'; resolve(result); });
  });
}

async function checkDns(hostname, resolvers) {
  const result = { status: 'ok', addresses: [], error: null, via: 'system' };
  try {
    const addrs = await dns.promises.resolve4(hostname);
    result.addresses = addrs;
  } catch (e1) {
    try {
      const resolver = new dns.promises.Resolver();
      resolver.setServers(resolvers);
      const addrs = await resolver.resolve4(hostname);
      result.addresses = addrs;
      result.via = 'fallback';
      result.note = '系统 DNS 失败，使用备用 DNS';
    } catch (e2) {
      result.status = 'fail';
      result.error = `系统: ${e1.message}, 备用: ${e2.message}`;
    }
  }
  return result;
}

async function checkPorts(hostname, ports, timeoutMs) {
  const results = [];
  for (const port of ports) {
    const r = { port, status: 'ok', elapsedMs: 0, error: null };
    try {
      const start = Date.now();
      await new Promise((resolve, reject) => {
        const s = new net.Socket();
        s.setTimeout(timeoutMs);
        s.on('connect', () => { s.destroy(); resolve(); });
        s.on('error', (e) => { s.destroy(); reject(e); });
        s.on('timeout', () => { s.destroy(); reject(new Error('timeout')); });
        s.connect(port, hostname);
      });
      r.elapsedMs = Date.now() - start;
    } catch (e) {
      r.status = 'fail';
      r.error = e.message;
    }
    results.push(r);
  }
  return results;
}

async function checkSecurityHeaders(url, timeoutMs) {
  const result = { status: 'ok', issues: [], error: null };
  try {
    const res = await httpGet(url, timeoutMs);
    const headers = res.headers || {};
    const securityHeaders = {
      'strict-transport-security': 'HSTS',
      'content-security-policy': 'CSP',
      'x-frame-options': 'X-Frame-Options',
      'x-content-type-options': 'X-Content-Type-Options',
      'referrer-policy': 'Referrer-Policy',
      'permissions-policy': 'Permissions-Policy',
    };
    for (const [header, name] of Object.entries(securityHeaders)) {
      if (!headers[header]) result.issues.push(`缺少 ${name}`);
    }
    if (result.issues.length > 0) {
      result.status = 'warn';
      result.note = result.issues.join(', ');
    }
    return result;
  } catch (e) {
    result.status = 'fail';
    result.error = e.message;
    return result;
  }
}

// ============== Phase 2 Checks (浏览器) ==============

async function checkPagespeedWithApi(url, strategy) {
  const result = { status: 'ok', strategy, score: null, fcp: null, lcp: null, tbt: null, cls: null, cruxData: null, error: null, attempts: 0 };

  if (!PSI_API_KEY) {
    result.status = 'skip';
    result.note = 'PSI_API_KEY 未配置';
    return result;
  }

  const MAX_ATTEMPTS = 2; // 同一站点+策略最多请求 2 次
  const RETRY_DELAY_MS = 3000; // 重试间隔 3 秒（避开 1 QPS 限制）

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    result.attempts = attempt;

    try {
      const apiUrl = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed' +
        `?url=${encodeURIComponent(url)}&strategy=${strategy}&key=${PSI_API_KEY}`;

      const start = Date.now();
      const res = await httpGet(apiUrl, 60000);
      const elapsed = Date.now() - start;

      const data = JSON.parse(res.body);

      // API 级别的错误（如 key 无效、配额超限）不重试
      if (data.error) {
        const errMsg = data.error.message || '';
        // 429 Too Many Requests / 配额相关 → 可重试
        if (errMsg.includes('quota') || errMsg.includes('rate') || data.error.code === 429) {
          if (attempt < MAX_ATTEMPTS) {
            console.log(`    ⚠️ 配额限制，${RETRY_DELAY_MS / 1000}s 后重试 (${attempt}/${MAX_ATTEMPTS})`);
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
            continue;
          }
        }
        result.status = 'fail';
        result.error = `API 错误: ${errMsg}`;
        return result;
      }

      const lhr = data.lighthouseResult;
      if (!lhr || !lhr.categories || !lhr.categories.performance) {
        if (attempt < MAX_ATTEMPTS) {
          console.log(`    ⚠️ 响应异常，${RETRY_DELAY_MS / 1000}s 后重试 (${attempt}/${MAX_ATTEMPTS})`);
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        result.status = 'fail';
        result.error = 'PSI API 响应结构异常';
        return result;
      }

      result.score = Math.round(lhr.categories.performance.score * 100);
      result.elapsedMs = elapsed;

      const audits = lhr.audits || {};
      if (audits['first-contentful-paint']) result.fcp = audits['first-contentful-paint'].displayValue;
      if (audits['largest-contentful-paint']) result.lcp = audits['largest-contentful-paint'].displayValue;
      if (audits['total-blocking-time']) result.tbt = audits['total-blocking-time'].displayValue;
      if (audits['cumulative-layout-shift']) result.cls = audits['cumulative-layout-shift'].displayValue;

      // CrUX 真实用户数据（Chrome User Experience Report）
      if (data.loadingExperience && data.loadingExperience.metrics) {
        const crux = data.loadingExperience;
        result.cruxData = {
          overall: crux.overall_category || null,
          fcpMs: crux.metrics.FIRST_CONTENTFUL_PAINT_MS?.percentile,
          lcpMs: crux.metrics.LARGEST_CONTENTFUL_PAINT_MS?.percentile,
          cls: crux.metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile,
        };
      }

      const threshold = strategy === 'mobile' ? 70 : 90;
      if (result.score < threshold) {
        result.status = 'fail';
        result.error = `${strategy === 'mobile' ? '手机' : '电脑'}端评分 ${result.score}，低于阈值 ${threshold}`;
      }

      return result;
    } catch (e) {
      lastError = e.message;
      if (attempt < MAX_ATTEMPTS) {
        console.log(`    ⚠️ 网络错误，${RETRY_DELAY_MS / 1000}s 后重试 (${attempt}/${MAX_ATTEMPTS})`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }

  result.status = 'fail';
  result.error = lastError || '达到最大重试次数';
  return result;
}

async function checkCdnBackToSource(url, browser) {
  const result = { status: 'ok', failedResources: [], error: null };
  const page = await browser.newPage();
  const failedResources = [];
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedResources.push({ url: response.url(), status: response.status(), type: response.request().resourceType() });
    }
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure();
    failedResources.push({ url: request.url(), status: 0, error: failure ? failure.errorText : 'unknown', type: request.resourceType() });
  });
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    if (failedResources.length > 0) {
      result.status = 'fail';
      result.failedResources = failedResources.slice(0, 10);
      result.error = `${failedResources.length} 个资源加载失败`;
      result.note = failedResources.slice(0, 3).map(r => r.url).join(', ');
    }
    await page.close();
    return result;
  } catch (e) {
    await page.close().catch(() => {});
    result.status = 'fail';
    result.error = e.message;
    return result;
  }
}

async function checkMobileAdapt(url, browser) {
  const result = { status: 'ok', issues: [], error: null };
  const page = await browser.newPage();
  await page.setViewport({ width: 400, height: 738 });
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    const checks = await page.evaluate(() => {
      const issues = [];
      const viewport = document.querySelector('meta[name="viewport"]');
      if (!viewport) issues.push('缺少 viewport meta 标签');
      const bodyWidth = Math.max(document.body.scrollWidth, document.documentElement.scrollWidth);
      if (bodyWidth > window.innerWidth * 1.15) {
        issues.push(`页面水平溢出 (内容${bodyWidth}px > 视口${window.innerWidth}px)`);
      }
      let smallFontCount = 0;
      const allElements = document.querySelectorAll('p, span, a, li, td, div, h1, h2, h3, h4, h5, h6');
      for (const el of allElements) {
        const fontSize = parseFloat(window.getComputedStyle(el).fontSize);
        if (fontSize > 0 && fontSize < 12 && el.textContent.trim().length > 0) { smallFontCount++; if (smallFontCount > 10) break; }
      }
      if (smallFontCount > 3) issues.push(`${smallFontCount} 处文字过小 (<12px)`);
      let smallTapCount = 0;
      const tappable = document.querySelectorAll('a, button, [role="button"], input[type="submit"]');
      for (const el of tappable) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44)) smallTapCount++;
      }
      if (smallTapCount > 5) issues.push(`${smallTapCount} 个可点击元素过小 (<44px)`);
      return issues;
    });
    result.issues = checks;
    if (checks.length > 0) {
      result.status = 'fail';
      result.error = checks.join('; ');
    }
    await page.close();
    return result;
  } catch (e) {
    await page.close().catch(() => {});
    result.status = 'fail';
    result.error = e.message;
    return result;
  }
}

// ============== 检查项标签 ==============
function checkLabel(key) {
  const map = {
    http: 'HTTP 可达性', ssl: 'SSL 证书', dns: 'DNS 解析', ports: '端口连通',
    pagespeed_mobile: '手机端性能', pagespeed_desktop: '电脑端性能',
    cdn: 'CDN 回源', mobileAdapt: '移动端适配', security: '安全响应头',
  };
  return map[key] || key;
}

// ============== 整体状态计算 ==============
function calcOverall(entry) {
  const p1Keys = ['http', 'ssl', 'dns', 'ports'];
  const p2Keys = ['pagespeed_mobile', 'pagespeed_desktop', 'cdn', 'mobileAdapt', 'security'];

  let p1Fail = 0, p1Warn = 0, p2Fail = 0, p2Warn = 0;

  for (const [key, val] of Object.entries(entry.checks)) {
    if (!val || val.status === 'skip') continue;
    if (Array.isArray(val)) {
      const arrFails = val.filter(v => v.status === 'fail').length;
      if (arrFails > 0) {
        if (p1Keys.includes(key)) p1Fail++;
        else if (p2Keys.includes(key)) p2Fail++;
      }
      continue;
    }
    if (val.status === 'fail') {
      if (p1Keys.includes(key)) p1Fail++;
      else if (p2Keys.includes(key)) p2Fail++;
    } else if (val.status === 'warn') {
      if (p1Keys.includes(key)) p1Warn++;
      else if (p2Keys.includes(key)) p2Warn++;
    }
  }

  entry.overallFailCount = p1Fail + p2Fail;

  if (p1Fail > 0) {
    entry.overall = 'fail';
  } else if (p1Warn > 0 || p2Fail > 0 || p2Warn > 0) {
    entry.overall = 'warn';
  } else {
    entry.overall = 'ok';
  }
}

// ============== 合并上一轮结果 ==============
function readExistingData() {
  try {
    if (fs.existsSync(DATA_PATH)) {
      return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return null;
}

function mergeExistingChecks(entry, existing, phase2Keys) {
  if (!existing || !existing.checks) return;
  for (const key of phase2Keys) {
    if (existing.checks[key] && !entry.checks[key]) {
      entry.checks[key] = { ...existing.checks[key], _fromPrevious: true };
    }
  }
}

// ============== 钉钉通知 ==============

async function sendDingtalkPerSite(entry, dingtalkConfig) {
  const { webhook, signKey } = dingtalkConfig || {};
  if (!webhook || webhook.includes('YOUR_TOKEN')) return;

  const mobiles = entry.dingtalkMobiles || [];
  // 仅收集 Phase 1 异常项（HTTP/SSL/DNS/端口/响应）
  // Phase 2（CDN/测速/移动端/安全）只看板预警，不做钉钉推送
  const p1Keys = ['http', 'ssl', 'dns', 'ports'];
  const issues = [];
  let hasP1Issue = false;
  for (const [key, check] of Object.entries(entry.checks || {})) {
    if (!p1Keys.includes(key)) continue;
    if (!check || check.status === 'skip' || check.status === 'ok') continue;
    if (Array.isArray(check)) {
      for (const p of check) {
        if (p.status === 'fail') { issues.push(`端口${p.port}${p.error || '不通'}`); hasP1Issue = true; }
      }
    } else if (check.status === 'fail') {
      issues.push(checkLabel(key) + (check.error ? check.error : '异常'));
      hasP1Issue = true;
    } else if (check.status === 'warn') {
      issues.push(checkLabel(key) + '需关注');
      hasP1Issue = true;
    }
  }

  if (!hasP1Issue) return;

  const isFail = entry.overall === 'fail';
  const icon = isFail ? '❌' : '⚠️';
  const atStr = mobiles.length > 0 ? mobiles.map(m => `@${m}`).join(' ') : '';
  const issueStr = issues.join('、');
  let text = `${icon} ${atStr}，${entry.url} ${issueStr}，请知悉并及时协调运维侧进行处理~`;

  let webhookUrl = webhook;
  if (signKey && signKey !== 'SECxxx') {
    const timestamp = Date.now();
    const stringToSign = timestamp + '\n' + signKey;
    const sign = encodeURIComponent(
      crypto.createHmac('sha256', signKey).update(stringToSign).digest('base64')
    );
    webhookUrl += `&timestamp=${timestamp}&sign=${sign}`;
  }

  const payload = JSON.stringify({
    msgtype: 'markdown',
    markdown: { title: `站点健康告警 — ${entry.name}`, text },
    at: { atMobiles: mobiles, isAtAll: false },
  });

  const parsed = new URL(webhookUrl);
  const lib = parsed.protocol === 'https:' ? https : http;

  console.log(`  📢 发送钉钉通知 → ${entry.name} (${mobiles.length} 人)`);

  return new Promise((resolve) => {
    const req = lib.request(parsed, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (result.errcode === 0) console.log(`  ✅ 通知已送达`);
          else console.error(`  ❌ 通知失败: ${result.errmsg}`);
        } catch (e) {
          console.error(`  ❌ 响应异常: ${body.substring(0, 200)}`);
        }
        resolve();
      });
    });
    req.on('error', (e) => { console.error(`  ❌ 发送失败: ${e.message}`); resolve(); });
    req.write(payload);
    req.end();
  });
}

// ============== 清理 body 字段 ==============
function cleanBodies(sites) {
  for (const entry of sites) {
    if (entry.checks.http) delete entry.checks.http.body;
  }
}

// ============== Main ==============
async function main() {
  // 解析命令行参数
  const mode = process.argv.includes('--basic') ? 'basic'
    : process.argv.includes('--browser') ? 'browser'
    : 'all';
  const siteFilter = process.argv.find(a => a.startsWith('--site='))?.split('=')[1] || null;

  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    console.error(`❌ 配置读取失败: ${e.message}`);
    process.exit(1);
  }

  const { sites: allSites, global: g } = config;
  const sites = siteFilter
    ? allSites.filter(s => s.url === siteFilter || s.name === siteFilter)
    : allSites;
  if (sites.length === 0) {
    console.log(`⚠️ 未找到站点: ${siteFilter}`);
    process.exit(0);
  }
  if (siteFilter) {
    console.log(`🎯 单站点检测: ${sites[0].name} (${sites[0].url})`);
  }
  if (!sites || sites.length === 0) {
    console.log('⚠️ 配置中无站点');
    process.exit(0);
  }

  const timeout = g.timeoutMs || 8000;
  const concurrency = g.concurrency || 3;
  const resolvers = g.dnsResolvers || ['8.8.8.8', '1.1.1.1'];

  // 读取已有数据（用于合并）
  const existingData = readExistingData();

  const output = {
    updatedAt: now(),
    updatedAtCN: nowCN(),
    phase1At: mode === 'basic' || mode === 'all' ? now() : (existingData?.phase1At || null),
    phase2At: mode === 'browser' || mode === 'all' ? now() : (existingData?.phase2At || null),
    sites: [],
  };

  const phaseLabel = mode === 'basic' ? 'Phase 1: 基础检查' : mode === 'browser' ? 'Phase 2: 浏览器检测' : '全部检测';
  console.log(`\n🏞 站点健康巡检 — ${nowCN()}`);
  console.log(`📋 模式: ${phaseLabel}\n`);

  // ============================================================
  // Phase 1: 基础检查 (HTTP / SSL / DNS / 端口 / 安全响应头)
  // ============================================================
  if (mode === 'basic' || mode === 'all') {
    console.log('📡 Phase 1: 基础连通性 + 安全响应头检查\n');

    for (let i = 0; i < sites.length; i += concurrency) {
      const batch = sites.slice(i, i + concurrency);
      const batchResults = await Promise.all(batch.map(async (site) => {
        process.stdout.write(`  🔳 ${site.name}... `);
        const url = new URL(site.url);
        const hostname = url.hostname;
        const entry = {
          name: site.name, url: site.url, hostname,
          owner: site.owner || null,
          dingtalkMobiles: site.dingtalkMobiles || [],
          checks: {}, overall: 'ok', overallFailCount: 0,
        };

        const promises = [];

        promises.push(
          checkHttpReachability(site.url, site.expectStatus || 200, timeout)
            .then(r => { entry.checks.http = r; return r; })
        );

        if (site.checkSsl !== false && url.protocol === 'https:') {
          promises.push(
            checkSsl(hostname, url.port || 443, timeout)
              .then(r => { entry.checks.ssl = r; return r; })
          );
        }

        if (site.checkDns !== false) {
          promises.push(
            checkDns(hostname, resolvers)
              .then(r => { entry.checks.dns = r; return r; })
          );
        }

        if (site.checkPorts && site.checkPorts.length > 0) {
          promises.push(
            checkPorts(hostname, site.checkPorts, timeout)
              .then(r => { entry.checks.ports = r; return r; })
          );
        }

        await Promise.allSettled(promises);

        // 安全响应头
        if (site.checkSecurity !== false) {
          entry.checks.security = await checkSecurityHeaders(site.url, timeout);
        }

        process.stdout.write(`✅ (基础检查完成)\n`);
        return entry;
      }));
      output.sites.push(...batchResults);
    }

    // 如果 mode === 'basic'，合并上一次 Phase 2 的结果
    if (mode === 'basic' && existingData && existingData.sites) {
      for (const entry of output.sites) {
        const existing = existingData.sites.find(s => s.url === entry.url);
        mergeExistingChecks(entry, existing, [
          'pagespeed_mobile', 'pagespeed_desktop', 'cdn', 'mobileAdapt'
        ]);
      }
    }

    // Phase 1 完成后计算状态 + 钉钉通知
    // mode=all 时推迟到 Phase 2 统一通知，避免重复推送
    for (const entry of output.sites) {
      calcOverall(entry);
      if (mode === 'basic') {
        if (entry.overall === 'fail' || entry.overall === 'warn') {
          await sendDingtalkPerSite(entry, g.dingtalk);
        }
      }
    }
  }

  // ============================================================
  // Phase 2: 浏览器检测 (PageSpeed API / CDN / 移动端适配)
  // ============================================================
  if (mode === 'browser' || mode === 'all') {
    const browserSites = sites.filter(s =>
      s.checkPagespeed !== false || s.checkCdn !== false || s.checkMobileAdapt !== false
    );

    if (browserSites.length > 0) {
      console.log('\n🔬 Phase 2: PageSpeed API + CDN + 移动端适配\n');

      // 如果 mode === 'browser'，从已有数据恢复 Phase 1 结果
      if (mode === 'browser' && existingData && existingData.sites) {
        for (const site of sites) {
          const existing = existingData.sites.find(s => s.url === site.url);
          const entry = {
            name: site.name, url: site.url, hostname: new URL(site.url).hostname,
            owner: site.owner || null,
            dingtalkMobiles: site.dingtalkMobiles || [],
            checks: {}, overall: 'ok', overallFailCount: 0,
          };
          if (existing) {
            for (const key of ['http', 'ssl', 'dns', 'ports', 'security']) {
              if (existing.checks[key]) {
                entry.checks[key] = Array.isArray(existing.checks[key])
                  ? [...existing.checks[key]]
                  : { ...existing.checks[key], _fromPrevious: false };
              }
            }
          }
          output.sites.push(entry);
        }
      }

      // --- Step 1: PageSpeed Insights API（无需浏览器）---
      console.log('  📡 PageSpeed Insights API 检测...\n');
      for (const entry of output.sites) {
        const site = sites.find(s => s.url === entry.url);
        console.log(`  📋 ${entry.name}`);

        if (!site || site.checkPagespeed === false) {
          entry.checks.pagespeed_mobile = { status: 'skip', note: '未启用' };
          entry.checks.pagespeed_desktop = { status: 'skip', note: '未启用' };
        } else {
          process.stdout.write(`    📱 手机端性能... `);
          entry.checks.pagespeed_mobile = await checkPagespeedWithApi(entry.url, 'mobile');
          const m = entry.checks.pagespeed_mobile;
          console.log(m.status === 'ok' ? `✅ ${m.score}分`
            : m.status === 'skip' ? '⏭️ 跳过'
            : `❌ ${m.score || '?'}分`);

          process.stdout.write(`    💻 电脑端性能... `);
          entry.checks.pagespeed_desktop = await checkPagespeedWithApi(entry.url, 'desktop');
          const d = entry.checks.pagespeed_desktop;
          console.log(d.status === 'ok' ? `✅ ${d.score}分`
            : d.status === 'skip' ? '⏭️ 跳过'
            : `❌ ${d.score || '?'}分`);
        }
      }

      // --- Step 2: CDN 回源 + 移动端适配（需要浏览器）---
      let chrome = null;
      let pupBrowser = null;
      try {
        const chromeFlags = ['--headless', '--disable-gpu'];
        if (process.platform === 'linux') {
          chromeFlags.push('--no-sandbox', '--disable-dev-shm-usage');
        }

        chrome = await chromeLauncher.launch({ chromeFlags });
        console.log(`\n  🟢 Chrome 已启动 (端口 ${chrome.port})\n`);

        pupBrowser = await puppeteer.connect({
          browserURL: `http://127.0.0.1:${chrome.port}`,
          defaultViewport: null,
        });

        for (const entry of output.sites) {
          const site = sites.find(s => s.url === entry.url);
          console.log(`  📋 ${entry.name}`);

          if (site && site.checkCdn !== false) {
            process.stdout.write(`    📦 CDN 回源... `);
            entry.checks.cdn = await checkCdnBackToSource(entry.url, pupBrowser);
            console.log(entry.checks.cdn.status === 'ok' ? '✅ 正常' : `❌ ${entry.checks.cdn.error || '异常'}`);
          } else {
            entry.checks.cdn = { status: 'skip', note: '未启用' };
          }

          if (site && site.checkMobileAdapt !== false) {
            process.stdout.write(`    📲 移动端适配... `);
            entry.checks.mobileAdapt = await checkMobileAdapt(entry.url, pupBrowser);
            console.log(entry.checks.mobileAdapt.status === 'ok'
              ? '✅ 正常'
              : `❌ ${entry.checks.mobileAdapt.issues?.length || 0} 个问题`);
          } else {
            entry.checks.mobileAdapt = { status: 'skip', note: '未启用' };
          }
        }
      } catch (e) {
        console.error(`\n  ❌ 浏览器启动失败: ${e.message}`);
        for (const entry of output.sites) {
          for (const key of ['cdn', 'mobileAdapt']) {
            if (!entry.checks[key]) {
              entry.checks[key] = { status: 'skip', note: `浏览器启动失败: ${e.message}` };
            }
          }
        }
      } finally {
        if (pupBrowser) { await pupBrowser.disconnect(); console.log('  🔌 Puppeteer 已断开'); }
        if (chrome) { await chrome.kill(); console.log('  🔴 Chrome 已关闭'); }
      }

      // --- Step 3: 计算状态 + 通知 ---
      // mode=browser: 不推送（P1 数据来自上一轮，可能已过期）
      // mode=all: 统一推送（Phase 1 已跳过，在此汇总 P1+P2 结果）
      for (const entry of output.sites) {
        calcOverall(entry);
        if (mode === 'all') {
          // 仅 P1 有实际异常时才推送，避免 P2 单方面问题触发空通知
          const hasP1Issue = ['http', 'ssl', 'dns', 'ports'].some(key => {
            const c = entry.checks[key];
            if (!c) return false;
            if (Array.isArray(c)) return c.some(p => p.status === 'fail');
            return c.status === 'fail' || c.status === 'warn';
          });
          if (hasP1Issue) {
            await sendDingtalkPerSite(entry, g.dingtalk);
          }
        }
      }
    }
  }

  // ============================================================
  // 写入 data.json
  // ============================================================
  cleanBodies(output.sites);

  // 如果 mode === 'all'，entries 可能重复（Phase 1 和 Phase 2 各创建了一次）
  // 去重：按 url 合并
  if (mode === 'all') {
    const merged = new Map();
    for (const entry of output.sites) {
      if (merged.has(entry.url)) {
        Object.assign(merged.get(entry.url).checks, entry.checks);
      } else {
        merged.set(entry.url, entry);
      }
    }
    output.sites = [...merged.values()];
  }

  // 重新计算一遍确保准确
  for (const entry of output.sites) {
    calcOverall(entry);
  }

  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(output, null, 2), 'utf8');

  const okSites = output.sites.filter(s => s.overall === 'ok');
  const warnSites = output.sites.filter(s => s.overall === 'warn');
  const failSites = output.sites.filter(s => s.overall === 'fail');

  console.log(`\n📊 报告已写入: ${DATA_PATH}`);
  console.log(`   共 ${output.sites.length} 站点`);
  console.log(`   ✅ ${okSites.length} 正常`);
  console.log(`   ⚠️ ${warnSites.length} 警告`);
  console.log(`   ❌ ${failSites.length} 异常`);
  if (output.phase1At) console.log(`   Phase 1: ${output.phase1At}`);
  if (output.phase2At) console.log(`   Phase 2: ${output.phase2At}`);
  console.log();

  return output;
}

if (require.main === module) {
  process.on('unhandledRejection', (err) => {
    if (err && err.code === 'EPERM') return; // 忽略 Windows 临时文件清理权限错误
    console.error('未捕获异常:', err?.message || err);
  });
  main().catch(e => { console.error('巡检失败:', e.message); process.exit(1); });
}

module.exports = { main, checkHttpReachability, checkSsl, checkDns, checkPorts, checkPagespeedWithApi, checkCdnBackToSource, checkMobileAdapt, checkSecurityHeaders };