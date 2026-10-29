// 验证脚本：观察 Unity 注册页上 reCAPTCHA 的真实加载行为，并判定「是否被 CSP 拦截」
//
// 用法：
//   node verify/verify.mjs --expect load     # 期望验证码脚本能加载（装了扩展，或上游已修复）
//   node verify/verify.mjs --expect block    # 期望被 CSP 拦截（旧策略 + 未装扩展）
//   node verify/verify.mjs                   # 只报告，不断言
//
// 参数：--port 9333   --url https://login.unity.com/zh/sign-up   --wait 15000
// 依赖：Node.js >= 22（内置 fetch / WebSocket），无需 npm install。

process.env.CDP_PORT = getArg('--port', '9333');
const { newTarget, Session } = await import('./cdp.mjs');

const SIGNUP = getArg('--url', 'https://login.unity.com/zh/sign-up');
const EXPECT = getArg('--expect', '');
const WAIT_PAGE = Number(getArg('--wait', '15000'));

function getArg(name, def) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = await newTarget('about:blank');
const s = await Session.attach(target);
await s.send('Page.enable');
await s.send('Runtime.enable');
await s.send('Network.enable');
await s.send('Log.enable');

const ev = [];
s.on('Network.responseReceived', (p) =>
  ev.push({ t: 'res', id: p.requestId, status: p.response.status, url: p.response.url, headers: p.response.headers || {} }));
s.on('Network.loadingFailed', (p) =>
  ev.push({ t: 'fail', id: p.requestId, url: p.requestId, error: p.errorText, reason: p.blockedReason || '' }));
s.on('Log.entryAdded', (p) => ev.push({ t: 'log', text: p.entry.text || '' }));

console.log('→ 打开', SIGNUP);
await s.send('Page.navigate', { url: SIGNUP });
await sleep(WAIT_PAGE);

// 部分地区会先落到「选择注册方式」页，需要点一次「使用邮箱登录」
const clicked = await s.eval(`(() => {
  const b = [...document.querySelectorAll('button,a')].find(x => /邮箱|mail/i.test(x.innerText || ''));
  if (!b) return null;
  b.click();
  return (b.innerText || '').trim();
})()`);
if (clicked) console.log('→ 点击了「' + clicked + '」');
await sleep(10000);

// ---------- 采集 ----------
const finalUrl = await s.eval('location.href');
const docs = ev.filter((e) => e.t === 'res' && /^https:\/\/login\.unity\.com\//.test(e.url || ''));
const cspDoc = docs.find((d) => d.headers['content-security-policy'] || d.headers['Content-Security-Policy']);
const cspValue = cspDoc ? cspDoc.headers['content-security-policy'] || cspDoc.headers['Content-Security-Policy'] : '';

// CSP 策略类型决定「主机白名单是否说了算」：
//   nonce + strict-dynamic → 由可信脚本动态插入的脚本一律放行，白名单形同失效
//   host-allowlist         → 只有名单内的主机能加载脚本
const policyType = !cspValue ? 'none'
  : (/'nonce-/.test(cspValue) && /strict-dynamic/.test(cspValue)) ? 'nonce+strict-dynamic'
  : 'host-allowlist';

const captchaScript = ev.filter((e) => e.t === 'res' && /gstatic\.cn\/recaptcha|gstatic\.com\/recaptcha/.test(e.url || ''));
const captchaFail = ev.filter((e) => e.t === 'fail' && /recaptcha/.test(e.url || ''));
const frames = ev.filter((e) => e.t === 'res' && /recaptcha\/enterprise\/(anchor|bframe)/.test(e.url || ''));
const violations = ev.filter((e) => e.t === 'log' && /Content Security Policy/i.test(e.text));

const execute = await s.eval(`!!(window.grecaptcha && window.grecaptcha.enterprise && window.grecaptcha.enterprise.execute)`);
const keys = await s.eval(`window.grecaptcha ? Object.keys(window.grecaptcha).join(',') : '(none)'`);
const scriptTags = await s.eval(`[...document.querySelectorAll('script[src]')].map(x => x.src).filter(u => /recaptcha/.test(u))`);

// ---------- 打印 ----------
const row = (k, v) => console.log('  ' + k.padEnd(30, ' ') + ' ' + v);
console.log('\n================ 观测结果 ================');
row('最终 URL', finalUrl);
row('主文档 CSP', cspDoc ? policyType : '不存在（被扩展移除 / 站点未下发）');
if (cspValue) {
  const m = cspValue.match(/script-src[^;]*/);
  if (m) row('  script-src 摘要', m[0].replace(/\s+/g, ' ').slice(0, 150) + '…');
}
row('gstatic 验证码脚本', captchaScript.length ? captchaScript.map((c) => c.status + ' ' + c.url.slice(0, 62)).join(' | ') : '(未请求)');
row('验证码请求失败', captchaFail.length ? captchaFail.map((f) => f.error + ' / ' + f.reason).join(' | ') : '(无)');
row('anchor / bframe', frames.length ? frames.map((f) => f.status).join(' / ') : '(未发出)');
row('grecaptcha keys', keys);
row('grecaptcha.enterprise.execute', String(execute));
row('CSP 违规条数', String(violations.length));
if (violations.length) row('  首条违规', violations[0].text.replace(/\s+/g, ' ').slice(0, 140) + '…');
console.log('==========================================\n');

// ---------- 判定 ----------
const scriptLoaded = captchaScript.some((c) => c.status === 200);
const blockedByCsp = captchaFail.some((f) => /csp/i.test(f.reason || '') || /csp/i.test(f.error || ''))
  || violations.some((v) => /gstatic\.cn/.test(v.text));

const state = scriptLoaded && execute ? 'load' : (blockedByCsp || !scriptLoaded) ? 'block' : 'unknown';

const label = {
  load: '验证码可正常加载（无需修复，或修复已生效）',
  block: '验证码被 CSP 拦截（需要修复）',
  unknown: '状态不明确：脚本未加载，但未观察到 CSP 拦截',
}[state];
console.log('判定：' + label);
if (policyType === 'none' && state === 'load') console.log('提示：当前页面没有 CSP 响应头（可能是本扩展移除了它），服务端原始策略需在对照组观察。');

if (EXPECT) {
  const ok = EXPECT === state;
  console.log(ok ? `PASS —— 与 --expect ${EXPECT} 一致` : `FAIL —— 期望 ${EXPECT}，实际 ${state}`);
  s.close();
  process.exit(ok ? 0 : 1);
}
s.close();
process.exit(0);
