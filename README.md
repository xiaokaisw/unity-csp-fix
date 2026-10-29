# 两条规则，修好一个注册页

> **Unity Signup CSP Fix** ｜ Unity「验证码无效，请重试」的根因定位、声明式修复与可复现验证

**一个只有 3 个文件的浏览器扩展：让 `login.unity.com` 注册页不再恒报「验证码无效，请重试」。**

它不猜、不重试、不换邮箱 —— 而是定位到真正的失败点：页面 CSP 白名单漏了中国区 CDN 域名，reCAPTCHA 脚本根本没被浏览器放行。

```
验证码脚本 gstatic.cn ──✗ 被 CSP 拦截──▶ 无 token ──▶ 服务端「验证码无效，请重试」
                          │
                          └─ 本扩展：只在这两个域移除 CSP 响应头 ──▶ 脚本 200 ──▶ 注册正常
```

---

## 〇、当前状态（请先读这段）

| 时间 | 观测 |
|---|---|
| 2026-10-24 | 命中**旧 CSP 策略**：`script-src 'self' 'unsafe-eval' 'unsafe-inline' + 主机白名单`，名单里没有 `www.gstatic.cn` → 验证码脚本被拦 → 注册恒报「验证码无效」 |
| 2026-10-29 | 复查命中**新 CSP 策略**：`script-src 'self' 'nonce-…' 'strict-dynamic' + 主机白名单`，由可信脚本动态插入的 `gstatic.cn` 脚本被放行 → 验证码正常初始化，**问题不再复现** |

也就是说：站点侧已在灰度/替换策略，同一个 URL 在不同时间可能拿到不同策略。
**本项目因此更像一套「诊断 + 修复 + 回归验证」工具**，而不是一个长期必需的补丁：

- 如果你现在打开注册页一切正常 → 你命中新策略，扩展装不装都一样（它会移除一个已经无害的响应头）；
- 如果你仍遇到「验证码无效」→ 你命中新策略之前的旧策略，扩展可立即恢复；
- `verify/verify.mjs` 会明确告诉你当前命中哪一种（判据见第四节）。

---

## 一、现象与结论

| | |
|---|---|
| **现象** | `https://login.unity.com/zh/sign-up` 填完邮箱/姓名/密码，点「创建帐户」，约 4 秒后提示「验证码无效，请重试」 |
| **直觉归因（错）** | 邮箱被占用 / 密码不合规 / 网络差 / 需要重试 |
| **真实根因** | `login.unity.com` 的 `Content-Security-Policy` 响应头 `script-src` 白名单里**没有 `https://www.gstatic.cn/recaptcha/`**，而 reCAPTCHA Enterprise 的加载器把真正的脚本写死在这个域名上 |
| **结论** | 用户输入无关、重试无用、换语言无用、挂梯子基本无用 —— 这是 Unity 前端的配置缺陷 |

**因果链**（每一环都有 CDP 抓包/控制台证据，见 [`docs/原理分析.md`](docs/原理分析.md)）：

1. 页面加载 `https://www.recaptcha.net/recaptcha/enterprise.js?...&render=explicit`；
2. 这个加载器返回的桩代码把 payload 指向 `https://www.gstatic.cn/recaptcha/releases/<ver>/recaptcha__zh_cn.js`（英文环境是 `recaptcha__en.js`，**域名不变**）；
3. 但文档响应头只放行 `www.recaptcha.net` 与 `www.gstatic.com`，`www.gstatic.cn` 不在其中；
4. 浏览器按 CSP 拒绝加载（`blockedReason: "csp"`，请求根本没发出去，所以**不是墙的问题**）；
5. `window.grecaptcha` 存在但 `grecaptcha.enterprise.execute === undefined`，表单提交时没有验证 token；
6. Next.js server action 返回 200，响应体里带错误，前端显示「验证码无效，请重试」。

---

## 二、这个扩展做了什么

`extension/rules.json` 里只有 **2 条 `declarativeNetRequest` 静态规则**，作用域被限制死：

| # | 匹配 | 动作 |
|---|---|---|
| 1 | `||login.unity.com/` | 移除响应头 `content-security-policy`、`content-security-policy-report-only`、`x-content-security-policy` |
| 2 | `||api.unity.com/` | 移除前两个 |

就这些，没有第 3 条，没有 JS 逻辑：

- **没有** 后台 service worker；
- **没有** 内容脚本（读不到 DOM、读不到你的输入）；
- **没有** 申请 `tabs` / `webRequest` / `cookies`；
- **没有** 任何网络请求代码，不收集任何数据。

---

## 三、安装

```bash
git clone https://github.com/<你的用户名>/unity-csp-fix.git
```

1. Edge 打开 `edge://extensions`（Chrome 打开 `chrome://extensions`）；
2. 打开「开发人员模式」（Chrome 是右上角「开发者模式」）；
3. 点「加载解压缩的扩展」，选择仓库中的 **`extension/`** 目录；
4. 打开注册页，按 `Ctrl + F5` 强刷。

> 「开发人员模式」需保持开启，否则浏览器会停用本地加载的扩展。

---

## 四、验证它真的生效（可复现）

仓库自带一个零依赖的验证脚本，用 CDP 直接观察真实网络与控制台行为，并给出 `load` / `block` 判定。

```bash
# 1) 起一个带扩展的独立浏览器实例（Windows，自动开 9333 端口）
powershell -ExecutionPolicy Bypass -File verify/run.ps1

# 2) 另开终端跑验证
node verify/verify.mjs --port 9333 --expect load

# 对照组（不加载扩展），用另一个端口
powershell -ExecutionPolicy Bypass -File verify/run.ps1 -Port 9334 -NoExtension
node verify/verify.mjs --port 9334 --expect load
.\verify\run.ps1 -Stop
```

实测三种组合（Edge 155 / Windows 11）：

| 检查项 | 旧策略 + 不装扩展 | 旧策略 + 装扩展 | 新策略（现状）+ 不装扩展 |
|---|---|---|---|
| 主文档 `content-security-policy` | `host-allowlist` | **不存在**（被移除） | `nonce+strict-dynamic` |
| `www.gstatic.cn/.../recaptcha__zh_cn.js` | `blockedReason: "csp"` | **200** | **200**（strict-dynamic 放行） |
| `recaptcha/enterprise/anchor` / `bframe` | 未发出 | **200 / 200** | **200 / 200** |
| `grecaptcha.enterprise.execute` | `false` | **`true`** | **`true`** |
| 控制台 CSP 违规 | 1 条 | **0 条** | **0 条** |
| 判定 | `block` | `load` | `load` |

脚本按 `--expect load|block` 校验并返回 `PASS / FAIL` 退出码，可直接接进 CI 做**回归检测**：一旦站点回退到旧策略，`--expect load` 会立刻变红。

---

## 五、仓库结构

```
unity-csp-fix/
├── extension/              扩展本体（加载这一层）
│   ├── manifest.json       MV3 声明：权限、host、规则集入口
│   ├── rules.json          ★ 全部逻辑：2 条 DNR 规则
│   └── icon128.png         图标
├── verify/                 可复现的验证工具（Node ≥ 22，零依赖）
│   ├── cdp.mjs             极简 Chrome DevTools Protocol 客户端
│   ├── verify.mjs          跑注册页，输出上表并断言
│   └── run.ps1             起一个带扩展的独立 Edge 实例
├── docs/
│   ├── 原理分析.md          根因定位全过程：证据、反证、被排除的猜测
│   ├── 源码说明.md          逐字段逐规则注释 + 设计取舍（DNR vs webRequest）
│   └── 对话记录.html        这次排查的完整对话（离线可读）
├── tools/
│   └── make-icon.ps1       图标生成脚本（可选，改了可以重跑）
├── LICENSE                 MIT
└── README.md
```

---

## 六、边界与风险

- 只在 Chromium 内核生效（Edge / Chrome / Brave…），Firefox 的 `declarativeNetRequest` 行为不同；
- **拿掉 CSP 等于关掉该页面一层防护**。本扩展只在 `login.unity.com` / `api.unity.com` 生效，其它站点不受影响；但在这两个域上，页面若有 XSS 漏洞，浏览器不再拦截。注册完建议停用；
- 这是**本地绕行**，不是对 Unity 的修复。Unity 只要在 CSP 里补上 `https://www.gstatic.cn/recaptcha/`（`script-src`、`frame-src`、`connect-src`），本扩展就可以退休；
- Unity 若更换域名或换验证码供应商，需要同步改 `rules.json`。

正因如此，本项目的价值主要在于**定位**：把一个「用户看起来是自己填错了」的失败，还原成一条可验证的服务端配置缺陷。

---

## 七、License

MIT © 2026 xiaokaisw

本项目与 Unity Technologies 无任何关联，未获其授权或背书。
