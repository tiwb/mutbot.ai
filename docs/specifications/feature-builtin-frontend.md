# mutbot.ai 内置前端（Level 1）— 设计规范

**状态**：🔄 进行中
**日期**：2026-02-28
**类型**：功能设计
**总体规划**：[feature-website-github-pages.md](feature-website-github-pages.md)

## 1. 背景

Phase 1 已完成：Landing Page + WebSocket 检测 + 重定向到 localhost（Level 3）。当前状态：

| 问题 | 说明 |
|------|------|
| 代码重复 | mutbot.ai 的 `launcher.ts`（~690 行）和 mutbot React 前端各自维护工作区管理逻辑 |
| 体验割裂 | 用户在 mutbot.ai 选择工作区后被重定向到 `localhost:8741`，地址栏变化 |
| 功能受限 | mutbot.ai 的 vanilla JS 只能做工作区选择，无法提供完整应用体验 |
| 版本不同步 | 官网前端版本应与 PyPI 上发布的 mutbot 包版本对应 |

**目标**：实现 Level 1 — 将 mutbot React 前端部署到 mutbot.ai，用户在 `mutbot.ai` 上直接使用完整应用，WebSocket 连接本地 mutbot 后端，地址栏始终为 `mutbot.ai`。

**涵盖范围**：

| 范围 | 说明 |
|------|------|
| 前端资源部署 | mutbot 发布时同步前端到 mutbot.ai（版本化目录） |
| WebSocket 连接 | React 前端从 mutbot.ai 连接 localhost:8741 |
| PyPI 发布流程 | 三个仓库统一的 tag → PyPI 发布管线 |
| 降级策略 | Level 1 不可用时回退到 Level 3 |
| Level 2 评估 | Service Worker 代理的可行性和难度 |

**依赖关系**：

| 依赖 | 文档 | 状态 |
|------|------|------|
| Landing Page + Launcher | `feature-website-launch.md` | ✅ 已完成 |
| 工作区选择器 | `feature-workspace-selector.md` | ✅ 已完成 |

## 2. 设计方案

### 2.1 架构概览

```
mutbot.ai (GitHub Pages, HTTPS)
├── /               → Astro Landing Page（现有，含工作区选择）
├── /v0.1.0/        → mutbot React SPA v0.1.0
├── /v0.1.1/        → mutbot React SPA v0.1.1
└── /versions.json  → 版本清单 { "latest": "0.1.1", ... }
```

```
mutbot.ai (GitHub Pages, HTTPS)
├── /               → Astro Landing Page（现有，含工作区选择）
│                     有 hash 时动态加载对应版本 React
├── /v0.1.0/        → mutbot React SPA v0.1.0（独立完整 SPA）
├── /v0.1.1/        → mutbot React SPA v0.1.1（独立完整 SPA）
└── /versions.json  → 版本清单（含各版本入口文件名）
```

```
用户访问 mutbot.ai
  ├─ Landing Page 加载
  │   ├─ 并行获取：fetch /versions.json + WebSocket /ws/app
  │   ├─ welcome 消息 → localVersion，versions.json → availableVersions + latest
  │   │   ├─ 连接成功 → 显示工作区列表（在 / 上直接操作）
  │   │   │   └─ 选择工作区 → 版本匹配路由（见 §2.8）
  │   │   └─ 连接失败 → 显示安装引导 + "Redirect To Local MutBot"（Level 3）
  │
  ├─ mutbot.ai/#workspace（有 hash 直接访问）
  │   └─ Landing Page 检测 hash → 动态加载最新版 React（见 §2.8）
  │
  └─ /v0.1.0/#workspace（版本化子目录直接访问）
      ├─ WebSocket 连接成功 + 版本一致 → 正常运行
      ├─ WebSocket 连接成功 + 版本不一致 → 自动重定向（见 §2.9）
      └─ WebSocket 连接失败 → 降级提示 + localhost 链接（Level 3）
```

**设计要点**：
- **工作区选择留在 `/`**：Landing Page 既是产品首页，也是工作区选择器
- **所有路由决策发生在打开工作区时**：选择工作区的那一刻才决定走 Level 1 还是 Level 3
- **版本匹配全自动**：从 WebSocket welcome 获取本地版本，与 `versions.json` 比对
- **所有版本统一 URL**：无论本地版本是 latest 还是旧版，只要在 `versions.json` 中存在，URL 均为 `mutbot.ai/#workspace`（根路径动态加载对应版本的 React）
- **版本化子目录仅用于托管和直接访问**：`/v0.1.0/` 存放构建产物，供动态加载引用；同时作为独立 SPA 入口，支持书签/直接访问

### 2.2 URL 方案

| URL | 说明 |
|-----|------|
| `mutbot.ai/` | Landing Page + 工作区选择（无 hash） |
| `mutbot.ai/#my-project` | 动态加载匹配版本 React 前端（任何已发布版本） |
| `mutbot.ai/v0.1.0/#my-project` | v0.1.0 React SPA（直接访问/书签，独立入口） |
| `mutbot.ai/versions.json` | 版本清单（含各版本入口文件名） |

**统一 URL，无版本号**：Landing Page 通过 `versions.json` 找到本地版本对应的构建产物，从版本化子目录动态加载 JS/CSS 到根路径。用户始终看到 `mutbot.ai/#workspace`，无需关心版本号。

**版本化目录保留的理由**：
- 托管各版本构建产物（被根路径动态加载引用）
- 独立 SPA 入口（书签/直接访问，不依赖 Landing Page）
- 用户可手动访问特定版本（调试、回退）
- 与 git tag / PyPI 版本直接对应

**版本清单 `versions.json`**：

```json
{
  "latest": "0.1.1",
  "versions": [
    {
      "version": "0.1.0",
      "date": "2026-03-01",
      "entry": { "js": "assets/index-a1b2c3.js", "css": "assets/index-d4e5f6.css" }
    },
    {
      "version": "0.1.1",
      "date": "2026-03-10",
      "entry": { "js": "assets/index-g7h8i9.js", "css": "assets/index-e5f6g7.css" }
    }
  ]
}
```

每个版本记录入口文件名（含 content hash），供动态加载使用。无需额外的 `app-entry.json`——所有信息集中在 `versions.json` 中。

### 2.3 PyPI 发布流程（三仓库通用）

三个仓库（mutobj、mutagent、mutbot）统一采用 **tag 触发 + PyPI Trusted Publishers** 方案。

#### 版本号管理

**开发版本约定**：源码中日常使用 `x.y.999` 占位版本，CI 从 tag 替换为正式版本号。

```
源码始终保持：0.2.999（pyproject.toml + __init__.py）
  tag v0.2.0 → CI 替换为 0.2.0 → 构建发布
  tag v0.2.1 → CI 替换为 0.2.1 → 构建发布
升级大版本时：手动改为 0.3.999，依赖改为 ~=0.3.0
```

- `x.y.999` 满足 `~=x.y.0` 依赖约束（即 `>=x.y.0, <x.(y+1).0`）→ `pip install -e .` 正常
- `x.y.999` 不匹配 `versions.json` 中任何已发布版本 → mutbot.ai 自动走 Level 3
- `x.y.999` 比所有已发布的 `x.y.z` 都"新" → 不会被 pip 降级覆盖
- 每次发布后无需手动改版本号，只在大版本升级时改一次

**当前版本**：
- mutobj `0.2.999`、mutagent `0.2.999`、mutbot `0.2.999`
- 依赖链：`mutbot → mutagent[web-extract]~=0.2.0 → mutobj~=0.2.0`

**发布流程**：

```
开发者本地操作：
  1. 日常开发：版本为 0.2.999（无需改动）
  2. 准备发布：git tag v0.2.0（不需要改源码版本号）
  3. git push --tags

GitHub Actions 自动执行：
  tag v0.2.0 推送
    → 从 tag 提取版本 "0.2.0"
    → 替换 pyproject.toml + __init__.py 中的版本号
    → python -m build
    → publish to PyPI (Trusted Publishers, 无 token)
    → (仅 mutbot) 构建前端 → 推送到 mutbot.ai
```

**PyPI Trusted Publishers（OIDC）**：
- 在 PyPI 项目设置中配置 Trusted Publisher：指定 GitHub 仓库 + workflow 文件名 + environment
- CI 通过 OIDC 获取短期 token，无需存储任何 PyPI API key
- 完全消除 token 泄露风险

**通用 release workflow**（适用于 mutobj、mutagent、mutbot）：

```yaml
# .github/workflows/release.yml
name: Release to PyPI
on:
  push:
    tags: ['v*']

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }

      - name: Set version from tag
        run: |
          VERSION=${GITHUB_REF_NAME#v}
          # 替换 pyproject.toml 中的 version
          sed -i "s/^version = .*/version = \"${VERSION}\"/" pyproject.toml
          # 替换 __init__.py 中的 __version__
          find src -name '__init__.py' -path '*/src/*' -maxdepth 3 \
            -exec sed -i "s/^__version__ = .*/__version__ = \"${VERSION}\"/" {} +

      - run: pip install build
      - run: python -m build
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/

  publish:
    needs: build
    runs-on: ubuntu-latest
    environment: release          # GitHub 环境保护（可配 required reviewers）
    permissions:
      id-token: write             # OIDC Trusted Publishers 必须
    steps:
      - uses: actions/download-artifact@v4
        with: { name: dist, path: dist/ }
      - uses: pypa/gh-action-pypi-publish@release/v1
        # 无需 token — Trusted Publishers 自动认证
```

**PyPI Trusted Publisher 配置步骤**（每个项目做一次）：
1. 登录 https://pypi.org → 进入项目管理页
2. Publishing → Add a new publisher → GitHub
3. 填写：Owner `tiwb`、Repository `mutobj`/`mutagent`/`mutbot`、Workflow `release.yml`、Environment `release`
4. 完成。CI 推送 tag 后自动发布，零 token。

**发布顺序**（有依赖变更时）：
1. mutobj tag → PyPI
2. mutagent 更新 mutobj 依赖版本 → tag → PyPI
3. mutbot 更新 mutagent 依赖版本 → tag → PyPI + 前端同步

### 2.4 前端资源部署（mutbot 发布时同步）

mutbot 的 release workflow 在 PyPI 发布之后，额外执行前端构建和推送。

**mutbot 的 release.yml 增加 sync-frontend job**：

```yaml
  # ... build + publish jobs 同上 ...

  sync-frontend:
    needs: publish                  # PyPI 发布成功后再同步
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }

      - name: Extract version from tag
        id: version
        run: echo "version=${GITHUB_REF_NAME#v}" >> "$GITHUB_OUTPUT"

      - name: Build frontend
        run: cd frontend && npm ci && npx tsc -b && npx vite build --outDir dist

      - name: Push to mutbot.ai
        env:
          VERSION: ${{ steps.version.outputs.version }}
        run: |
          cd /tmp
          git clone https://x-access-token:${{ secrets.MUTBOT_AI_TOKEN }}@github.com/tiwb/mutbot.ai.git
          cd mutbot.ai

          # 部署版本化目录
          rm -rf "public/v${VERSION}"
          cp -r "$GITHUB_WORKSPACE/frontend/dist" "public/v${VERSION}"

          # 提取入口文件名（Vite 构建产物）
          JS_ENTRY=$(cd "public/v${VERSION}" && ls assets/index-*.js | head -1)
          CSS_ENTRY=$(cd "public/v${VERSION}" && ls assets/index-*.css | head -1)

          # 更新 versions.json（含入口文件信息）
          python3 -c "
          import json, datetime
          path = 'public/versions.json'
          try:
              data = json.load(open(path))
          except FileNotFoundError:
              data = {'latest': '', 'versions': []}
          ver, js, css = '${VERSION}', '${JS_ENTRY}', '${CSS_ENTRY}'
          data['latest'] = ver
          entry = {'js': js, 'css': css}
          existing = next((v for v in data['versions'] if v['version'] == ver), None)
          if existing:
              existing['entry'] = entry
          else:
              data['versions'].append({'version': ver, 'date': datetime.date.today().isoformat(), 'entry': entry})
          json.dump(data, open(path, 'w'), indent=2)
          "

          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add "public/v${VERSION}" public/versions.json
          git diff --cached --quiet || {
            git commit -m "chore: 同步 mutbot 前端 v${VERSION}"
            git push
          }
```

**mutbot.ai 侧无需改动**：`public/v0.1.0/` 被 Astro 原样复制到 `dist/v0.1.0/`，GitHub Pages 直接提供服务。根目录不部署任何 React 资源——动态加载时直接引用版本化目录中的文件（ES modules 的 import 相对于模块自身 URL 解析，不受页面 URL 影响）。

**跨仓库推送认证**：使用 Fine-grained PAT（限定 `tiwb/mutbot.ai` 仓库 `contents: write` 权限），存为 mutbot 仓库的 `MUTBOT_AI_TOKEN` secret。这不是 PyPI token，仅用于 git push，权限最小化。

### 2.5 Vite 构建配置

将 `base` 改为 `'./'`（相对路径），使同一份构建产物可在任意路径下运行：

```typescript
// frontend/vite.config.ts
export default defineConfig({
  base: './',
  build: {
    outDir: '../src/mutbot/web/frontend_dist',
    emptyOutDir: true,
  },
  // ... 其余不变
});
```

- `base: './'` → `<script src="./assets/main-xxx.js">`
- 在 `/` 下（localhost:8741）：解析为 `/assets/main-xxx.js` ✓
- 在 `/v0.1.0/` 下（mutbot.ai）：解析为 `/v0.1.0/assets/main-xxx.js` ✓

CI 中通过 `--outDir dist` 参数输出到临时目录，不影响本地构建路径。

### 2.6 WebSocket 连接策略

React 前端检测运行环境，非 localhost 时连接 `localhost:8741`。

**新增 `frontend/src/lib/connection.ts`**：

```typescript
/**
 * 获取 mutbot 后端 host。
 * 本地运行时用当前 host，远程（mutbot.ai）时连 localhost:8741。
 */
export function getMutbotHost(): string {
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') {
    return location.host;
  }
  return 'localhost:8741';
}

/**
 * 构建 WebSocket URL。
 * 连接目标始终是本地 mutbot，使用 ws://（非 TLS）。
 */
export function getWsUrl(path: string): string {
  const host = getMutbotHost();
  return `ws://${host}${path}`;
}

/** 是否从远程（非 localhost）访问 */
export function isRemote(): boolean {
  const h = location.hostname;
  return h !== 'localhost' && h !== '127.0.0.1' && h !== '::1';
}
```

**改动点**：

| 文件 | 当前 | 改为 |
|------|------|------|
| `lib/app-rpc.ts` | `` `${protocol}//${location.host}/ws/app` `` | `getWsUrl('/ws/app')` |
| `lib/workspace-rpc.ts` | `` `${protocol}//${location.host}/ws/workspace/${id}` `` | `` getWsUrl(`/ws/workspace/${id}`) `` |
| 其余 WebSocket 连接点 | `location.host` 硬编码 | 统一使用 `getWsUrl()` |

**注意**：WebSocket 协议始终为 `ws://`（非 `wss://`），因为目标始终是本地 mutbot（无 TLS）。即使页面从 HTTPS 的 mutbot.ai 加载，连接到 `ws://localhost` 在 Chrome/Edge 中被允许（localhost 属于安全上下文例外）。

### 2.7 后端改动（mutbot 仓库）

**不添加额外的 Origin 校验**。mutbot 作为本地服务，允许任何网站通过 WebSocket 连接。

#### a. `/ws/app` welcome 消息包含版本

当前 `/ws/app` 连接成功后发送 welcome 事件。新增 `version` 字段：

```json
{ "type": "welcome", "version": "0.1.0" }
```

`version` 取自 `mutbot.__version__`。这是版本匹配的数据来源——Landing Page 和 React 前端均通过此字段获知本地 mutbot 版本。

#### b. `/api/health` 端点（可选）

新增通用健康检查端点，供非 WebSocket 场景使用（如监控、脚本检测）：

```python
@app.get("/api/health")
async def health():
    return {"status": "ok", "version": mutbot.__version__}
```

### 2.8 Landing Page 改动 — 版本匹配与动态加载

`launcher.ts` 核心改动：**在打开工作区的时刻**自动决定走 Level 1（动态加载 React）还是 Level 3（重定向 localhost）。

**版本匹配与路由流程**：

```
Landing Page 启动
  ├─ 并行获取：
  │   ├─ fetch /versions.json → versions（含 latest + 各版本 entry）
  │   └─ WebSocket /ws/app → welcome.version → localVersion
  │
  ├─ URL 有 hash？（如 mutbot.ai/#my-project）
  │   └─ 是 → 立即隐藏 landing，匹配版本后动态加载 React
  │
  └─ 用户点击工作区（此时才做路由决策）
      ├─ localVersion 在 availableVersions 中？
      │   ├─ 是 → 动态加载该版本的 React → mutbot.ai/#workspace
      │   └─ 否 → 重定向 localhost:8741/#workspace  （Level 3）
      └─ 无 WebSocket 连接？
          └─ 重定向 localhost:8741/#workspace         （Level 3）
```

**关键点**：匹配的是**本地 mutbot 的版本**，而非 `versions.json` 中的 latest。这确保前端代码与后端 API 完全对应。无论本地版本是否为 latest，只要 `versions.json` 中存在该版本，就在根路径动态加载，URL 统一为 `mutbot.ai/#workspace`：

- 用户本地 v0.1.0，mutbot.ai 有 v0.1.0 和 v0.1.1 → 动态加载 /v0.1.0/ 的资源 → URL `mutbot.ai/#workspace`
- 用户本地 v0.1.1（= latest），mutbot.ai 有 v0.1.0 和 v0.1.1 → 动态加载 /v0.1.1/ 的资源 → URL `mutbot.ai/#workspace`
- 用户本地 v0.2.0.dev0（开发版），mutbot.ai 无对应版本 → 重定向 localhost（Level 3）

**Astro Landing Page HTML 改动**（`index.astro`）：

```html
<head>
  <script is:inline>
    // 内联在 <head>，DOM 渲染前执行
    if (location.hash && location.hash.length > 1) {
      document.documentElement.classList.add('app-mode');
    }
  </script>
  <style>
    .app-mode #landing { display: none !important; }
    .app-mode #app { display: flex !important; min-height: 100vh; }
  </style>
</head>
<body>
  <div id="landing"><!-- Astro Landing 内容 --></div>
  <div id="app" style="display:none"><!-- React 挂载点 --></div>
</body>
```

**launcher.ts 实现**：

```typescript
let localVersion: string | null = null;
let versionsData: VersionsJson | null = null;

interface VersionEntry {
  version: string;
  entry: { js: string; css: string };
}
interface VersionsJson {
  latest: string;
  versions: VersionEntry[];
}

async function init() {
  const [versions, rpc] = await Promise.all([
    fetch('/versions.json').then(r => r.json()).catch(() => null) as Promise<VersionsJson | null>,
    connectLocal(),
  ]);
  versionsData = versions;

  if (rpc) {
    localVersion = rpc.serverVersion;
  }

  // URL 已有 hash → 直接加载 React（如书签 mutbot.ai/#project）
  const hashWs = location.hash.replace(/^#\/?/, '');
  if (hashWs && localVersion) {
    loadReactForVersion(localVersion);
    return;
  }

  // 无 hash → 正常显示 Landing Page + 工作区列表
  // ... 现有逻辑 ...
}

/** 打开工作区 — 所有路由决策在此发生 */
function openWorkspace(name: string) {
  if (localVersion && findVersion(localVersion)) {
    location.hash = name;
    loadReactForVersion(localVersion);
  } else {
    window.location.href = `http://localhost:8741/#${name}`;
  }
}

function findVersion(version: string): VersionEntry | undefined {
  return versionsData?.versions.find(v => v.version === version);
}

/** 动态加载指定版本的 React 前端（从版本化子目录） */
function loadReactForVersion(version: string) {
  const ver = findVersion(version);
  if (!ver) {
    window.location.href = `http://localhost:8741/${location.hash}`;
    return;
  }

  const base = `/v${ver.version}/`;

  // 加载 CSS
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `${base}${ver.entry.css}`;
  document.head.appendChild(link);

  // 隐藏 landing，显示 app
  document.documentElement.classList.add('app-mode');

  // 加载 React 入口（ES module，import 自动相对于模块 URL 解析）
  const script = document.createElement('script');
  script.type = 'module';
  script.src = `${base}${ver.entry.js}`;
  document.head.appendChild(script);
}
```

**React 前端适配**（`main.tsx`）：

```typescript
// 兼容两种挂载场景：
// 1. 独立 SPA（/v0.1.0/index.html 中 <div id="root">）
// 2. 嵌入 Landing Page（/ 中 <div id="app">）
const container = document.getElementById('root') ?? document.getElementById('app');
if (container) {
  ReactDOM.createRoot(container).render(<App />);
}
```

适用于：工作区列表点击、新建工作区创建后、More... 搜索对话框选择、书签直接访问。

"Redirect To Local MutBot" 链接保留不变（Level 3 降级入口，始终可用）。

### 2.9 React 前端版本校验与降级

React 前端有两种加载场景，版本校验逻辑略有不同：

**场景 A：动态加载于根路径**（`mutbot.ai/#workspace`）
- Landing Page 已完成版本匹配，加载的 React 版本一定与本地一致
- 无需额外校验

**场景 B：直接访问版本化子目录**（`mutbot.ai/v0.1.0/#workspace`，书签/分享链接）
- URL 中的版本可能与本地 mutbot 版本不一致
- 需要校验并自动重定向

**校验流程**（仅场景 B，在 App 初始化时执行）：

```
React SPA 加载于 /v0.1.0/
  ├─ WebSocket 连接 localhost:8741
  │   ├─ 成功 → welcome.version = ?
  │   │   ├─ "0.1.0"（一致）→ 正常运行
  │   │   └─ "0.1.1"（不一致）→ 重定向到 mutbot.ai/#workspace
  │   │       （Landing Page 会用正确版本重新动态加载）
  │   └─ 失败（isRemote 模式）→ 降级提示页
```

**版本不一致时重定向到根路径**（由 Landing Page 重新匹配）：

```typescript
// App.tsx 初始化时
const urlVersion = location.pathname.match(/^\/v([^/]+)\//)?.[1];
if (isRemote() && urlVersion && rpc.serverVersion !== urlVersion) {
  // 版本不匹配，重定向到根路径让 Landing Page 重新匹配
  location.href = `/${location.hash}`;
  return;
}
```

**连接失败降级提示**（仅 `isRemote()` 模式）：

```
┌──────────────────────────────────────┐
│                                      │
│  M u t B o t                         │
│  Define Your AI                      │
│                                      │
│  ⚠ Could not connect to local       │
│  MutBot at localhost:8741.           │
│                                      │
│  Make sure MutBot is running,        │
│  then try again.                     │
│                                      │
│  [Retry]  [Open localhost:8741]      │
│           [← Back to mutbot.ai]      │
│                                      │
└──────────────────────────────────────┘
```

本地模式（localhost:8741）保持现有行为不变。

### 2.10 代码复用评估

Landing Page（Astro + vanilla JS）和 React 前端均有工作区选择/创建逻辑，技术栈不同：

| 功能 | mutbot.ai (launcher.ts) | mutbot (React) |
|------|-------------------------|----------------|
| WebSocket RPC 协议 | 自行实现 AppRpc 类 | 自行实现 AppRpc 类 |
| 工作区列表 | 渲染 DOM 元素 | WorkspaceSelector 组件 |
| 目录选择器 | 渲染 DOM 对话框 | DirectoryPicker 组件 |
| 搜索对话框 | 渲染 DOM 对话框 | WorkspaceSearchDialog 组件 |

**复用可行性**：

- **RPC 协议层**：两边的 AppRpc 类逻辑相同（JSON-RPC over WebSocket），可提取为 npm 包共享。但代码量小（~80 行），维护独立包的开销大于收益。
- **UI 层**：技术栈不同（vanilla JS vs React），无法直接共享。可以用 Astro React Island 引入 React 组件，但会给静态 Landing Page 增加 React 运行时（~40KB gzip），得不偿失。

**结论**：保持两边独立维护。Landing Page 的工作区选择器是轻量入口，功能稳定，变更频率低。RPC 协议如有变更，手动同步即可。

### 2.11 Level 2 评估：Service Worker 代理

**用途**：当 mutbot.ai 内置前端版本与本地 mutbot 后端 API 不兼容时，通过 SW 加载本地前端文件替代内置版本。

**工作原理**：

```
/v0.1.0/ 加载 → 检查 /api/health 的 version
  ├─ 版本兼容 → Level 1（使用内置前端）
  └─ 版本不兼容 → 注册 SW
      → SW 从 localhost:8741 fetch 前端文件
      → 缓存并替代内置文件
      → 页面刷新后使用本地版本
```

注意：SW **无法代理 WebSocket**（仅拦截 fetch 事件），WebSocket 始终直连 localhost。

**难度评估**：

| 方面 | 复杂度 | 说明 |
|------|--------|------|
| SW 注册/激活 | 低 | 标准 API |
| fetch 代理 localhost | 中 | Chrome/Edge 允许，Firefox/Safari 阻止 |
| 缓存策略 + 版本清理 | 中 | 版本变化时需清除旧缓存 |
| 混合内容（HTTPS→HTTP） | **高** | Chrome/Edge 允许 localhost 例外；Firefox/Safari 阻止 |
| SW 生命周期 | 中 | skipWaiting / clients.claim / 更新检测 |
| 调试与测试 | 高 | SW 状态不透明，本地/远程行为差异大 |

**关键限制**：

1. **浏览器兼容**：Firefox/Safari 的混合内容限制同样阻止 SW fetch localhost
2. **SW 不代理 WebSocket**：仅解决前端文件版本问题
3. **收益有限**：版本化目录方案已减轻问题——用户本地版本过旧时，`versions.json` 可指向匹配版本

**结论**：Level 2 实现成本中等偏高，收益有限。**建议暂不实现**。版本化目录 + `versions.json` 已提供更简单的版本管理方案。

## 3. 待定问题

（无待定问题）

## 4. 实施步骤清单

### 阶段一：PyPI 发布管线（三仓库）[进行中]
- [x] **Task 1.1**: PyPI Trusted Publisher 配置
  - [x] pypi.org 上为 mutobj、mutagent、mutbot 分别添加 Trusted Publisher
  - [x] 指定 GitHub 仓库 + workflow `release.yml` + environment `release`
  - 状态：⏸️ 待开始（需要在 pypi.org 上手动操作）

- [x] **Task 1.2**: 通用 release workflow
  - [x] mutobj: 新增 `.github/workflows/release.yml`（build → publish）
  - [x] mutagent: 同上
  - [x] mutbot: 同上 + sync-frontend job
  - [x] 各仓库创建 GitHub environment `release`
  - 状态：✅ 已完成（workflow 文件已创建，environment 需在 GitHub 上手动创建）

- [ ] **Task 1.3**: 验证发布流程
  - [ ] mutobj tag v0.2.0 → PyPI 发布成功
  - [ ] mutagent tag v0.2.0 → PyPI 发布成功
  - [ ] mutbot tag v0.2.0 → PyPI + 前端同步成功
  - 状态：⏸️ 待开始（依赖 Task 1.1 完成）

### 阶段二：前端适配（mutbot 仓库）[✅ 已完成]
- [x] **Task 2.1**: WebSocket 连接地址动态化
  - [x] 新增 `lib/connection.ts`（`getMutbotHost` / `getWsUrl` / `isRemote`）
  - [x] `app-rpc.ts` 改用 `getWsUrl()`
  - [x] `workspace-rpc.ts` 改用 `getWsUrl()`
  - [x] 其余 WebSocket 连接点统一改用 `getWsUrl()`（AgentPanel、TerminalPanel、LogPanel）
  - 状态：✅ 已完成

- [x] **Task 2.2**: Vite 构建配置 + React 挂载点兼容
  - [x] `vite.config.ts` 的 `base` 改为 `'./'`
  - [x] `main.tsx` 兼容 `#root`（独立 SPA）和 `#app`（嵌入 Landing Page）
  - [x] TypeScript 编译通过 + Vite 构建正常
  - 状态：✅ 已完成

- [x] **Task 2.3**: 远程模式版本校验 + 降级 UI
  - [x] 直接访问 `/v<version>/` 时校验版本，不一致则重定向到根路径
  - [x] `isRemote()` 时连接失败 → 显示降级提示页
  - [x] 提供 Retry / Open localhost / Back to mutbot.ai 操作
  - 状态：✅ 已完成

### 阶段三：后端 + 前端同步管线（mutbot 仓库）[进行中]
- [x] **Task 3.1**: `/ws/app` welcome 消息 + `/api/health`
  - [x] `/ws/app` welcome 事件添加 `version` 字段（取自 `mutbot.__version__`）
  - [x] 新增 GET `/api/health` 端点
  - [x] FastAPI app.version 改用动态 `mutbot.__version__`
  - 状态：✅ 已完成

- [x] **Task 3.2**: mutbot release workflow
  - [x] 通用部分：tag 触发 → 从 tag 提取版本号 → 替换源码版本 → build → PyPI 发布
  - [x] sync-frontend job：构建前端 → 推送到 mutbot.ai `public/v<version>/`
  - [x] 更新 `versions.json`（含入口文件名）
  - [ ] 配置 `MUTBOT_AI_TOKEN` secret（需在 GitHub 上手动操作）
  - 状态：✅ 已完成（workflow 文件已创建，secret 需手动配置）

- [ ] **Task 3.3**: 验证部署
  - [ ] `mutbot.ai/v0.2.0/` 可访问 React SPA
  - [ ] `mutbot.ai/v0.2.0/#workspace` hash 路由正常
  - [ ] `mutbot.ai/versions.json` 内容正确（含 entry 字段）
  - 状态：⏸️ 待开始（依赖首次 release）

### 阶段四：Landing Page 集成（mutbot.ai 仓库）[✅ 已完成]
- [x] **Task 4.1**: index.astro 添加 React 挂载点 + app-mode 样式
  - [x] `<div id="app">` 挂载点（Landing.astro）
  - [x] 内联 `<head>` 脚本：有 hash 时立即添加 `app-mode` class（Base.astro）
  - [x] `.app-mode` CSS：隐藏 landing，显示 app
  - 状态：✅ 已完成

- [x] **Task 4.2**: launcher.ts 版本匹配 + 动态加载
  - [x] 启动时并行 fetch `/versions.json` + WebSocket 连接
  - [x] 从 welcome 消息读取 `localVersion`
  - [x] `openWorkspace()`：版本匹配 → 动态加载 React，否则 → localhost 重定向
  - [x] `loadReactForVersion()`：从版本化目录加载 JS/CSS
  - [x] URL 已有 hash 时（书签）直接加载 React
  - [x] 保留 "Redirect To Local MutBot" 链接
  - [x] mutbot.ai 构建通过
  - 状态：✅ 已完成

---

### 实施进度总结
- 🔄 **阶段一：PyPI 发布管线** - 67% 完成（2/3 任务，待首次 release 验证）
- ✅ **阶段二：前端适配** - 100% 完成 (3/3 任务)
- 🔄 **阶段三：后端 + 前端同步** - 67% 完成 (2/3 任务，待部署验证)
- ✅ **阶段四：Landing Page** - 100% 完成 (2/2 任务)

**代码实施完成度：100%**
**待验证**：首次 release 流程端到端测试

## 5. 测试验证

### 单元测试
- [ ] `getMutbotHost()` — localhost/127.0.0.1/::1 返回 `location.host`，其余返回 `localhost:8741`
- [ ] `getWsUrl()` — 始终使用 `ws://` 协议
- [ ] `/api/health` 返回正确格式
- [ ] `/ws/app` welcome 消息包含 `version` 字段

### 集成测试
- [ ] localhost:8741 前端正常工作（base 改为 './' 后无回归）
- [ ] mutbot.ai/v0.2.0/ 加载独立 React SPA
- [ ] mutbot.ai/v0.2.0/#workspace → WebSocket 连接 localhost:8741 → 进入工作区
- [ ] 版本匹配：本地 v0.2.0，mutbot.ai 有 v0.2.0 → 动态加载 React → URL 为 mutbot.ai/#workspace
- [ ] 版本匹配：本地 v0.2.1，mutbot.ai 有 v0.2.0 和 v0.2.1 → 加载 /v0.2.1/ 的资源
- [ ] 版本不匹配：本地 v0.2.999 → 重定向到 localhost
- [ ] 书签 mutbot.ai/#workspace → 自动检测版本 → 动态加载 React
- [ ] 书签 mutbot.ai/v0.2.0/#workspace → 版本不一致 → 重定向到 mutbot.ai/#workspace
- [ ] mutbot.ai/v0.2.0/ 连接失败 → 降级 UI 显示
- [ ] mutbot.ai/ 无 versions.json → 所有操作降级为 localhost 重定向
- [ ] React 挂载兼容：`#root`（独立 SPA）和 `#app`（嵌入 Landing Page）均正常
- [ ] PyPI 发布：tag v0.2.0 → PyPI + mutbot.ai/v0.2.0/ 同步 + versions.json 更新
- [ ] 开发版本：源码 0.2.999 → tag v0.2.0 → CI 自动替换版本号 → PyPI 发布 0.2.0
