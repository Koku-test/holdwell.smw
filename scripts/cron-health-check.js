/**
 * 站点健康巡检 — Cron 包装器（MVP 版）
 * 输出到 dashboard/data.json，供 HTML 看台读取
 */
require('./site-health-check').main().then(r => {
  const ok = (r.sites || []).filter(s => s.overall === 'ok').length;
  const warn = (r.sites || []).filter(s => s.overall === 'warn').length;
  const fail = (r.sites || []).filter(s => s.overall === 'fail').length;
  const total = ok + warn + fail;

  console.log(`\n📊 巡检完成: ${total} 站点 — ✅ ${ok} / ⚠️ ${warn} / ❌ ${fail}`);
  console.log(`📄 看台数据: dashboard/data.json`);

  if (fail > 0) {
    console.log(`\n🚨 异常站点:`);
    for (const s of r.sites) {
      if (s.overall === 'fail') {
        console.log(`  ❌ ${s.name} (${s.url})`);
        for (const [ck, cv] of Object.entries(s.checks || {})) {
          if (Array.isArray(cv)) {
            for (const p of cv) { if (p.status === 'fail') console.log(`    端口 ${p.port}: ${p.error}`); }
          } else if (cv && cv.status === 'fail') {
            console.log(`    ${ck}: ${cv.error || cv.notice || '异常'}`);
          }
        }
      }
    }
  }
  if (warn > 0) {
    console.log(`\n⚠️ 需关注站点:`);
    for (const s of r.sites) {
      if (s.overall === 'warn') {
        console.log(`  ⚠️ ${s.name} (${s.url})`);
        for (const [ck, cv] of Object.entries(s.checks || {})) {
          if (cv && cv.status === 'warn') {
            const issues = cv.issues ? cv.issues.join('; ') : (cv.notice || `${ck} 需关注`);
            console.log(`    ${ck}: ${issues}`);
          }
        }
      }
    }
  }
}).catch(e => { console.error('巡检失败:', e.message); process.exit(1); });
