# mutbot.ai 网站启动 — 实施规范

**状态**：🔄 进行中
**日期**：2026-02-26
**类型**：功能设计
**总体规划**：[feature-website-github-pages.md](feature-website-github-pages.md)

## 1. 背景

本文档是 mutbot.ai 总体规划的 **Phase 1**：让网站跑起来，能检测并连接本地 MutBot。

**目标**：用户打开 `mutbot.ai`，本地有 MutBot 就自动连接进入界面，没有就展示安装引导。

**不包含**：GitHub 登录、Web 配置向导、跨设备同步、`${browser:key}` 配置等（Phase 2+）。

## 2. 技术栈

| 组件 | 选择 |
|------|------|
| 框架 | Astro 5.x |
| 样式 | Tailwind CSS 4 |
| 交互组件 | 原生 JS（Phase 1 不需要 React Islands） |
| 部署 | GitHub Actions → GitHub Pages |
| 包管理 | npm |

## 3. 项目结构

```
mutbot.ai/
├── docs/specifications/          # 设计文档（不参与构建）
├── src/
│   ├── layouts/
│   │   └── Base.astro            # 基础布局（暗色主题、meta）
│   ├── pages/
│   │   └── index.astro           # 唯一页面
│   ├── components/
│   │   ├── Landing.astro         # 未连接状态：产品介绍
│   │   └── AppShell.astro        # 已连接状态：应用容器
│   ├── scripts/
│   │   ├── launcher.ts           # 核心：检测 + 三级降级逻辑
│   │   └── sw.ts                 # Service Worker（Level 2 代理）
│   └── styles/
│       └── global.css
├── public/
│   ├── favicon.svg
│   ├── sw.js                     # SW 编译产物
│   ├── install.sh                # Linux/macOS 安装脚本
│   ├── install.ps1               # Windows 安装脚本
│   └── CNAME                     # mutbot.ai
├── .github/
│   └── workflows/
│       └── deploy.yml
├── astro.config.mjs
├── tailwind.config.mjs
├── tsconfig.json
└── package.json
```

## 4. 核心：Launcher 逻辑

### 4.1 检测与降级流程

```typescript
// src/scripts/launcher.ts

async function launch() {
  const health = await detectLocal("http://localhost:8741/api/health");

  if (!health) {
    showLanding();    // 展示产品介绍 + 安装引导
    return;
  }

  if (!canFetchLocalhost()) {
    // Firefox/Safari → Level 3
    redirectToLocal(health);
    return;
  }

  if (isApiCompatible(health.api_version)) {
    // Level 1: 内置前端 + 本地 API
    loadBuiltinApp(health);
  } else {
    // Level 2: SW 代理加载本地前端
    await loadViaServiceWorker(health);
  }
}
```

### 4.2 本地检测

```typescript
async function detectLocal(url: string): Promise<HealthResponse | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return await res.json();
  } catch {
    return null;
  }
}
```

`/api/health` 预期响应（需 mutbot 后端配合，见 `feature-website-cors.md`）：

```json
{
  "status": "ok",
  "api_version": "1.0.0"
}
```

### 4.3 浏览器能力检测

```typescript
function canFetchLocalhost(): boolean {
  // 检测方式：detectLocal 是否成功已隐式证明
  // 如果 detectLocal 成功 → 说明当前浏览器允许 HTTPS→localhost fetch
  // 如果失败，无法区分"服务未启动"和"浏览器阻止"
  // 所以真正的检测在 detectLocal 阶段一起完成
  return true; // 走到这里说明 detectLocal 成功了
}
```

实际上 Firefox/Safari 在 `detectLocal` 就会失败（混合内容阻止）。需要一个后备检测机制：

```typescript
async function launch() {
  // 尝试 fetch localhost
  const health = await detectLocal("http://localhost:8741/api/health");

  if (!health) {
    // 无法确定原因：服务未运行 or 浏览器阻止
    // 展示 Landing，同时提供手动连接按钮
    showLanding({ showManualConnect: true });
    return;
  }

  // fetch 成功 → 浏览器支持 HTTPS→localhost → Chrome/Edge 路径
  if (isApiCompatible(health.api_version)) {
    loadBuiltinApp(health);
  } else {
    await loadViaServiceWorker(health);
  }
}
```

Landing Page 上的手动连接按钮：`<a href="http://localhost:8741">Open local MutBot</a>`
— 这是 top-level 导航，所有浏览器都允许。Firefox/Safari 用户点击即可进入。

### 4.4 Level 1：内置前端

Phase 1 先实现 **Level 3（重定向）** 作为唯一连接方式，Level 1（内置前端）需要 mutbot CI 同步前端构建产物，作为后续优化。

Phase 1 简化流程：

```
检测到本地 MutBot → 直接重定向到 http://localhost:8741
检测不到 → 展示 Landing Page
```

### 4.5 Level 2：Service Worker 代理

Phase 1 不实现。需要 Level 1 先跑通后，作为版本不兼容的降级方案加入。

## 5. Landing Page 设计

暗色主题 + 极简科技风，单页。

### 5.1 HTML 结构

```
<body class="dark bg-gray-950 text-white">
  <!-- App Container (已连接时显示) -->
  <div id="app" class="hidden"></div>

  <!-- Landing (未连接时显示) -->
  <div id="landing">
    <header>导航栏: Logo + GitHub link</header>
    <section id="hero">
      <h1>MutBot</h1>
      <p class="tagline">Define Your AI</p>
      <div class="install-cmd">
        <code>curl -LsSf https://mutbot.ai/install.sh | sh</code>
        <button>Copy</button>
      </div>
      <a href="http://localhost:8741" class="btn-secondary">
        Open local MutBot →
      </a>
    </section>
    <section id="features">
      3 个功能卡片: You Define / Always Evolving / Fully Local
    </section>
    <footer>GitHub | Docs | License</footer>
  </div>
</body>
```

### 5.2 SEO & Meta

```html
<title>MutBot — Define Your AI</title>
<meta name="description" content="Your personal AI assistant that evolves to match your work style. Runs locally, fully private." />
<meta property="og:title" content="MutBot — Define Your AI" />
<meta property="og:description" content="Your personal AI assistant. Runs locally." />
<meta property="og:url" content="https://mutbot.ai" />
<link rel="canonical" href="https://mutbot.ai" />
```

## 6. GitHub Actions 部署

```yaml
# .github/workflows/deploy.yml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist/
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

## 7. 安装脚本

### install.sh (Linux/macOS)

```bash
#!/bin/sh
set -eu

echo "Installing MutBot..."

# Install uv if not present
if ! command -v uv >/dev/null 2>&1; then
    echo "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi

# Install mutbot via uv (auto-downloads Python if needed)
uv tool install mutbot

echo ""
echo "Done! Run 'mutbot' to start, then open https://mutbot.ai"
```

### install.ps1 (Windows)

```powershell
Write-Host "Installing MutBot..."

# Install uv if not present
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "Installing uv..."
    irm https://astral.sh/uv/install.ps1 | iex
}

# Install mutbot
uv tool install mutbot

Write-Host ""
Write-Host "Done! Run 'mutbot' to start, then open https://mutbot.ai"
```

## 8. 实施步骤清单

### 阶段一：项目骨架 [进行中]
- [x] **Task 1.1**: 初始化 Astro 项目
  - [x] `npm create astro@latest`
  - [x] 安装 Tailwind CSS 集成
  - [x] 配置 `astro.config.mjs`（site: `https://mutbot.ai`）
  - 状态：✅ 已完成

- [x] **Task 1.2**: 配置部署
  - [x] 创建 `.github/workflows/deploy.yml`
  - [x] 添加 `public/CNAME`
  - [ ] 推送并验证 GitHub Pages 部署
  - 状态：🔄 待推送验证

### 阶段二：Landing Page [待开始]
- [ ] **Task 2.1**: 基础布局 + 暗色主题
  - [ ] `Base.astro` 布局（暗色主题、字体、meta tags）
  - [ ] 全局 CSS + Tailwind 配置
  - 状态：⏸️ 待开始

- [ ] **Task 2.2**: Hero + Features + Footer
  - [ ] Logo + Tagline "Define Your AI"
  - [ ] 安装命令 + 复制按钮
  - [ ] 3 个功能卡片
  - [ ] Footer
  - [ ] 响应式适配
  - 状态：⏸️ 待开始

### 阶段三：Launcher 逻辑 [待开始]
- [ ] **Task 3.1**: 本地检测
  - [ ] `launcher.ts`：fetch localhost:8741/api/health
  - [ ] 检测成功 → 重定向到 localhost（Phase 1 简化版）
  - [ ] 检测失败 → 展示 Landing
  - [ ] 手动连接按钮（Firefox/Safari 用户）
  - 状态：⏸️ 待开始

### 阶段四：安装脚本 [待开始]
- [ ] **Task 4.1**: 编写安装脚本
  - [ ] `public/install.sh`
  - [ ] `public/install.ps1`
  - [ ] 测试各平台
  - 状态：⏸️ 待开始
