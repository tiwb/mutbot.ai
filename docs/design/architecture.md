# mutbot.ai 架构设计

> 本文档记录 mutbot.ai 的关键架构决策和方向性设计信息。**永不归档**，随项目演进持续更新。

## 产品定位

**核心理念**：打开网页就是应用本身。

- **已安装用户**：打开 mutbot.ai → 自动连接本地/远程 MutBot → 直接进入工作界面
- **新用户**：打开 mutbot.ai → 检测不到 MutBot → 展示产品介绍 + 安装引导

## 技术栈

| 层 | 技术 |
|------|------|
| 静态站点 | Astro 5.x + Tailwind CSS 4 |
| 托管 | GitHub Pages，域名 `mutbot.ai` |
| React SPA | mutbot 前端构建产物，版本化部署（`/v{version}/`） |
| 版本管理 | `versions.json`（CI 自动维护） |
| 本地开发 | `vite-dev-local.mjs` 插件注入本地构建 |

## 页面架构：一页两态

```
URL 无 hash → Landing 模式（产品介绍 + 服务器卡片 + 工作区列表）
URL 有 hash → App 模式（隐藏 Landing，加载 React SPA）
```

`Base.astro` 内联脚本在 DOM 渲染前检测 hash，通过 CSS class `app-mode` 切换，无闪烁。

## 连接架构

### 三级降级

| Level | 条件 | 方式 | 体验 |
|-------|------|------|------|
| 1 | Chrome/Edge + 版本匹配 | 内置 React SPA + 远程 WebSocket | 地址栏 mutbot.ai |
| 2 | 版本不匹配 | 重定向到服务器 | 地址栏 server:port |
| 3 | Firefox/Safari | 重定向到服务器 | 地址栏 server:port |

Level 2（Service Worker 代理）原计划为独立层级，实际未实施，直接降级为重定向。

### 浏览器 HTTPS → localhost 限制

| 操作 | Chrome/Edge | Firefox | Safari |
|------|-------------|---------|--------|
| fetch/WebSocket localhost | OK | 不支持 | 不支持 |
| 重定向到 localhost | OK | OK | OK |

### 多服务器管理

- 服务器列表存 `localStorage["mutbot:servers"]`
- 每个服务器：`{ id, label, url, lastVersion?, lastConnectedAt? }`
- Hash 格式：`#workspace@serverLabel`（`@` 前为工作区名，后为服务器标签）
- `/connect/#host:port` — 快速添加服务器的独立页面

## 版本化部署

mutbot CI release 时自动执行：

1. 构建前端 → 产物放入 `public/v{version}/`
2. 更新 `versions.json`（添加新版本，更新 latest）
3. 推送到 mutbot.ai 仓库

`launcher.ts` 根据服务器报告的版本号在 `versions.json` 中查找匹配，加载对应版本的 JS/CSS。

## React SPA 集成协议

mutbot.ai 通过 `window.__MUTBOT_CONTEXT__` 向 React SPA 传递上下文：

```typescript
window.__MUTBOT_CONTEXT__ = {
  remote: true,           // 标识为远程模式（非 localhost 直连）
  wsBase: "ws://host:port", // WebSocket 连接目标
  workspace: "workspace_name" // 要打开的工作区
}
```

React SPA 挂载到 `#app`（mutbot.ai）或 `#root`（本地），`main.tsx` 兼容两种。

## 待实施方向

### 身份验证（对应 mutbot feature-openid-auth）

远程服务器启用认证后，mutbot.ai 侧需要：
- WebSocket 连接收到 4401 关闭码 → 触发登录流程
- 跳转到 `server/auth/login?return_to=https://mutbot.ai` 完成 OIDC
- Token 通过 URL fragment 回传，存 localStorage（按服务器分存）
- 重连时 `tokenFn` 自动附加 `?token=xxx`

### CORS 配置（mutbot 后端）

```
Access-Control-Allow-Origin: https://mutbot.ai
Access-Control-Allow-Private-Network: true
```

## 关键文件索引

| 文件 | 作用 |
|------|------|
| `src/scripts/launcher.ts` | 核心客户端逻辑（~1100 行） |
| `src/layouts/Base.astro` | HTML 骨架 + app-mode 早期检测 |
| `src/components/Landing.astro` | Landing 页面静态内容 |
| `src/pages/index.astro` | 首页入口 |
| `src/pages/connect.astro` | /connect/ 快速添加服务器 |
| `public/versions.json` | 版本索引，CI 自动维护 |
| `plugins/vite-dev-local.mjs` | 本地开发插件 |
| `astro.config.mjs` | Astro 配置 |
