/**
 * 站点健康巡检 — 综合版
 * =====================
 * 输出: dashboard/data.json（供 HTML 看台读取）
 *
 * 已实现:
 *   ✅ 1. 站点无法访问 (HTTP/DNS/TCP) — 48h, 连续 3 次, 第 2 次告警
 *   ✅ 2. SSL 证书过期 (剩余天数记录, ≤7 天告警) — 48h
 *   ✅ 3. DNS 配置异常 (挂在 #1 下) — 48h
 *   ✅ 5. 页面加载超慢 (HTTP 响应时间 + PageSpeed Insights) — 48h
 *
 * 待实现:
 *   ⏳ 4. CDN 回源失败 (Puppeteer 瀑布流分析) — 48h
 *   ⏳ 8. 移动端适配 (Puppeteer 400x738 截图 + vision 分析) — 48h
 *   ⏳ 9. 安全漏洞 (Snyk 依赖+网站扫描) — 每周, 高危告警
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');
const dns = require('dns');

// ============== Paths ==============
const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'sites-config.json');
const DATA_PATH = path.join(ROOT, 'dashboard', 'data.json');

// ============== Utils ==============
function now() { return new Date().toISOString(); }
function nowCN() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}
function elapsed(start) { return Date.now() - start; }

function httpGet(url, timeoutMs, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const start = Date.now();
    const req = lib.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'SOMW-HealthCheck/1.0' } }, (res) => {
      // 跟随重定向
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

// ============== Checks ==============

/** 1. HTTP 可达性检查 */
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
    // 重定向备注
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

/** 2. SSL 证书检查 */
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
        result.elapsedMs = elapsed(start);

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

/** 3. DNS 解析 */
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

/** 端口连通性 */
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

/** 5. PageSpeed Insights 评分检查 */
async function checkPagespeedInsights(url, strategy, apiKey) {
  const result = {
    status: 'ok',
    strategy,
    score: null,
    fcp: null, lcp: null, tbt: null, cls: null,
    error: null,
  };

  if (!apiKey) {
    result.status = 'skip';
    result.note = '未配置 pagespeedApiKey';
    return result;
  }

  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&key=${apiKey}`;

  try {
    const start = Date.now();
    const res = await httpGet(endpoint, 60000); // 60s timeout
    const elapsed = Date.now() - start;

    if (res.statusCode !== 200) {
      result.status = 'fail';
      result.error = `API 返回 ${res.statusCode}`;
      return result;
    }

    const data = JSON.parse(res.body);
    const lr = data.lighthouseResult;
    if (!lr || !lr.categories || !lr.categories.performance) {
      result.status = 'fail';
      result.error = 'API 响应结构异常';
      return result;
    }

    const rawScore = lr.categories.performance.score;
    result.score = Math.round(rawScore * 100);
    result.elapsedMs = elapsed;

    // 核心指标
    const audits = lr.audits || {};
    if (audits['first-contentful-paint']) result.fcp = audits['first-contentful-paint'].displayValue;
    if (audits['largest-contentful-paint']) result.lcp = audits['largest-contentful-paint'].displayValue;
    if (audits['total-blocking-time']) result.tbt = audits['total-blocking-time'].displayValue;
    if (audits['cumulative-layout-shift']) result.cls = audits['cumulative-layout-shift'].displayValue;

    // 评分判定
    const threshold = strategy === 'mobile' ? 70 : 90;
    if (result.score < threshold) {
      result.status = 'fail';
      result.error = `${strategy === 'mobile' ? '手机' : '电脑'}端评分 ${result.score}，低于阈值 ${threshold}`;
    }

    return result;
  } catch (e) {
    result.status = 'fail';
    result.error = e.message;
    return result;
  }
}

/** 占位检查 */
function checkPlaceholder(name) {
  return { status: 'skip', note: `${name} 待实现` };
}

// ============== Main ==============
async function main() {
  // 读取配置
  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    console.error(`❌ 配置读取失败: ${e.message}`);
    process.exit(1);
  }

  const { sites, global: g } = config;
  if (!sites || sites.length === 0) {
    console.log('⚠️ 配置中无站点');
    process.exit(0);
  }

  const timeout = g.timeoutMs || 8000;
  const concurrency = g.concurrency || 3;
  const resolvers = g.dnsResolvers || ['8.8.8.8', '1.1.1.1'];
  const output = { updatedAt: now(), updatedAtCN: nowCN(), sites: [] };

  console.log(`\n🏥 站点健康巡检 — ${nowCN()}\n`);

  for (let i = 0; i < sites.length; i += concurrency) {
    const batch = sites.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(async (site) => {
      process.stdout.write(`  🔍 ${site.name}... `);
      const url = new URL(site.url);
      const hostname = url.hostname;
      const entry = {
        name: site.name, url: site.url, hostname,
        checks: {}, overall: 'ok', overallFailCount: 0,
      };

      // --- 并发执行各项检查 ---
      const promises = [];

      // 1. HTTP 可达性
      promises.push(
        checkHttpReachability(site.url, site.expectStatus || 200, timeout)
          .then(r => { entry.checks.http = r; return r; })
      );

      // 2. SSL（仅 HTTPS）
      if (site.checkSsl !== false && url.protocol === 'https:') {
        promises.push(
          checkSsl(hostname, url.port || 443, timeout)
            .then(r => { entry.checks.ssl = r; return r; })
        );
      }

      // 3. DNS
      if (site.checkDns !== false) {
        promises.push(
          checkDns(hostname, resolvers)
            .then(r => { entry.checks.dns = r; return r; })
        );
      }

      // 端口
      if (site.checkPorts && site.checkPorts.length > 0) {
        promises.push(
          checkPorts(hostname, site.checkPorts, timeout)
            .then(r => { entry.checks.ports = r; return r; })
        );
      }

      await Promise.allSettled(promises);

      // 5. PageSpeed Insights 评分（独立于其他检查，不阻塞）
      const psiKey = g.pagespeedApiKey || process.env.PAGESPEED_API_KEY || null;
      if (site.checkPagespeed !== false && psiKey) {
        entry.checks.pagespeed_mobile = await checkPagespeedInsights(site.url, 'mobile', psiKey);
        entry.checks.pagespeed_desktop = await checkPagespeedInsights(site.url, 'desktop', psiKey);
      }

      // 占位检查
      if (site.checkCdn !== false) {
        entry.checks.cdn = checkPlaceholder('CDN 回源检查');
      }
      if (site.checkMobileAdapt !== false) {
        entry.checks.mobileAdapt = checkPlaceholder('移动端适配检查');
      }
      if (site.checkSecurity !== false) {
        entry.checks.security = checkPlaceholder('安全漏洞扫描');
      }

      // --- 聚合整体状态 ---
      let failCount = 0;
      for (const [key, val] of Object.entries(entry.checks)) {
        if (!val || val.status === 'skip') continue;
        if (val.status === 'fail') failCount++;
        if (Array.isArray(val)) {
          const arrFails = val.filter(v => v.status === 'fail').length;
          if (arrFails > 0) failCount++;
        }
      }
      entry.overallFailCount = failCount;
      if (failCount > 0) entry.overall = 'fail';
      else {
        let hasWarn = false;
        for (const [key, val] of Object.entries(entry.checks)) {
          if (!val || val.status === 'skip' || val.status === 'ok') continue;
          if (val.status === 'warn') { hasWarn = true; break; }
          if (Array.isArray(val)) {
            if (val.some(v => v.status === 'warn')) { hasWarn = true; break; }
          }
        }
        entry.overall = hasWarn ? 'warn' : 'ok';
      }

      // 清理 body（不写入 JSON）
      if (entry.checks.http) delete entry.checks.http.body;

      process.stdout.write(`${entry.overall === 'ok' ? '✅' : entry.overall === 'warn' ? '⚠️' : '❌'} (${failCount} 项异常)\n`);
      return entry;
    }));

    output.sites.push(...batchResults);
  }

  // 写入 data.json
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(output, null, 2), 'utf8');

  console.log(`\n📊 报告已写入: ${DATA_PATH}`);
  console.log(`   共 ${output.sites.length} 站点`);
  console.log(`   ✅ ${output.sites.filter(s => s.overall === 'ok').length} 正常`);
  console.log(`   ⚠️ ${output.sites.filter(s => s.overall === 'warn').length} 警告`);
  console.log(`   ❌ ${output.sites.filter(s => s.overall === 'fail').length} 异常\n`);

  return output;
}

if (require.main === module) {
  main().catch(e => { console.error('巡检失败:', e.message); process.exit(1); });
}

module.exports = { main, checkHttpReachability, checkSsl, checkDns, checkPorts, checkPagespeedInsights };
