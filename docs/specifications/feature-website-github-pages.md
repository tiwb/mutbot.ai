# mutbot.ai 总体规划

**状态**：🔄 进行中
**日期**：2026-02-26
**类型**：功能设计

本文档是 mutbot.ai 网站的总体设计规划，包含全局架构和分阶段实施路线。各阶段的实施细节在独立规范文档中。

## 1. 产品定位

**核心理念**：你来定义 AI 助理的行为，让它进化到完全符合你的工作方式。

**Tagline**: "Define Your AI"

mutbot.ai 不是传统宣传页——**打开网页就是应用本身**：

- **已安装用户**：打开 mutbot.ai → 自动连接本地 MutBot → 直接进入工作界面
- **新用户**：打开 mutbot.ai → 检测不到本地 MutBot → 同一页面展示产品介绍 + 一键安装引导

## 2. 全局决策

- **仓库**：独立仓库 `tiwb/mutbot.ai`
- **托管**：GitHub Pages，域名 `mutbot.ai`
- **框架**：Astro 5.x + Tailwind CSS 4
- **设计风格**：暗色主题 + 极简科技风
- **内容语言**：英文为主
- **安装**：基于 uv 的一键安装（`curl -LsSf https://mutbot.ai/install.sh | sh`）

## 3. 架构概述

```
┌──────────────────────────────────────────────────────────┐
│  https://mutbot.ai  (GitHub Pages 静态托管)               │
│                                                          │
│  Landing Page ── 产品介绍 + 安装引导（未连接时）           │
│  App Shell ───── 内置前端 + 本地 API（Level 1）           │
│  SW Proxy ────── 代理加载本地前端（Level 2）               │
│  Redirect ────── 重定向到 localhost（Level 3）             │
│                                                          │
└────────────────────────┬─────────────────────────────────┘
                         │ fetch + WebSocket
                         │ http://localhost:8741
            ┌────────────┴────────────┐
            │ 本地 MutBot             │
            │ 后端 API + WebSocket    │
            │ 前端 JS/CSS 资源        │
            └─────────────────────────┘
```

### 三级降级

| Level | 条件 | 方式 | 体验 |
|-------|------|------|------|
| 1 ⭐ | Chrome/Edge + API 兼容 | 内置前端 + 本地 API | 秒开，地址栏 mutbot.ai |
| 2 | Chrome/Edge + API 不兼容 | SW 代理加载本地前端 | 地址栏 mutbot.ai |
| 3 | Firefox/Safari | 重定向到 localhost | 功能完整，地址栏 localhost |

## 4. 分阶段实施路线

### Phase 1：网站启动 — 让基础跑起来

**目标**：Landing Page + 本地检测 + 重定向连接（Level 3）

| 仓库 | 文档 | 内容 |
|------|------|------|
| mutbot.ai | [`feature-website-launch.md`](feature-website-launch.md) | Astro 建站、Landing Page、Launcher 逻辑、部署、安装脚本 |
| mutbot | [`feature-website-cors.md`](../../mutbot/docs/specifications/feature-website-cors.md) | CORS 支持、`/api/health` 端点 |

### Phase 2：内置前端（Level 1 最优路径）

**目标**：mutbot CI 同步前端到 mutbot.ai，实现内置前端 + 本地 API 模式

- mutbot CI 构建前端 → 同步到 mutbot.ai 仓库 `app/` 目录
- API 版本协商（`/api/health` 返回 `api_version`）
- 内置前端通过 fetch + WebSocket 连接本地后端

### Phase 3：Config 值来源扩展

**目标**：mutagent Config 支持 `${source:key}` 可扩展语法，mutbot 注册 `browser` 来源

- mutagent：`Config.register_value_source(name, resolver)` 注册机制
- mutagent：内置 `env` 来源（`$VAR` / `${env:VAR}`，向后兼容）
- mutbot：注册 `browser` 来源 + `BrowserValueStore`
- config.json 使用 `"${browser:github_token}"` 占位符，实际值由前端 WebSocket 推送

### Phase 4：Web 配置向导

**目标**：MutBot 默认通过 Web 向导完成首次 LLM 配置

- mutbot 启动无 LLM 配置时进入 setup 模式（启动 Web 服务器等待配置）
- Web 向导选项：GitHub Copilot (Free) / Anthropic / OpenAI / Custom / Skip
- Token 存储：浏览器 localStorage（默认）或本地配置文件
- 账号连接是可选的，用户可完全本地配置

### Phase 5：GitHub 登录 + 跨设备同步

**目标**：GitHub 账号连接（可选），Gist 同步配置

- 注册 MutBot 专用 GitHub OAuth App
- Device Flow 通过本地 MutBot 代理（已有实现 `copilot/auth.py`）
- 私有 Gist 同步用户配置（连接地址 + 偏好）
- 未来可扩展其他 LLM 提供商账号（Google → Gemini 等）

## 5. 关键设计细节

### 5.1 安装方案：基于 uv

uv（Astral 的 Rust 原生包管理器）可自动下载 Python，用户无需预装任何依赖：

```bash
# Linux/macOS
curl -LsSf https://mutbot.ai/install.sh | sh

# Windows
irm https://mutbot.ai/install.ps1 | iex

# 已有 uv 的用户
uv tool install mutbot
```

### 5.2 页面设计

**一个页面，两种状态**：

- **已连接**：加载 MutBot 界面（Phase 1 为重定向，Phase 2+ 为内置前端）
- **未连接**：Hero（Logo + "Define Your AI" + 安装命令）+ 功能卡片（You Define / Always Evolving / Fully Local）+ Footer

### 5.3 浏览器 HTTPS→localhost 限制

| 操作 | Chrome/Edge | Firefox | Safari |
|------|-------------|---------|--------|
| fetch localhost | ✅ | ❌ | ❌ |
| WebSocket localhost | ✅ | ❌ | ❌ |
| 重定向到 localhost | ✅ | ✅ | ✅ |

### 5.4 Token 安全模型（Phase 3+）

- 默认存浏览器 localStorage，config.json 中仅 `${browser:...}` 占位符
- 前端通过 WebSocket 推送 Token → 后端内存使用，不落盘
- 明文 Token 写入 config.json 也支持（两种方式兼容）

### 5.5 CORS 配置（mutbot 后端）

```
Access-Control-Allow-Origin: https://mutbot.ai
Access-Control-Allow-Private-Network: true
```
