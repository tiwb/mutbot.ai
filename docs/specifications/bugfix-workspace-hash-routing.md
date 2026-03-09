# Workspace Hash 路由修复 设计规范

**状态**：🔄 实施中
**日期**：2026-03-09
**类型**：Bug修复

## 背景

mutbot.ai 实现多机器连接后，URL hash 从 `#workspace` 变为 `#workspace@serverLabel`。当 mutbot.ai 以 Level 1（动态加载 React SPA）方式打开工作区时，React SPA 读取 `location.hash` 得到 `workspace@serverLabel`，将整个字符串当作工作区名匹配，导致找不到工作区而打不开。

同时，本地开发时 mutbot 版本为 `0.5.999`，无法匹配 `versions.json` 中的任何条目，始终走 Level 3 redirect，无法测试 Level 1 完整流程。

## 核心设计原则

**mutbot.ai 本质上只是替换了 landing 页面**。workspace 体验（React SPA）不关心谁是 landing。

- mutbot.ai landing = Astro 多服务器选择器
- mutbot landing = React WorkspaceSelector 组件
- React SPA（workspace 视图）= 完全一样，不区分来源

因此：**历史管理全部在 React SPA（App.tsx）中统一处理，零 `isRemote` 判断**。mutbot.ai 只负责设好 hash、传好 context、加载 SPA 脚本，以及 popstate 时 reload 恢复自己的 Astro landing。

## 设计方案

### 问题一：hash 中 `@serverLabel` 导致 workspace 打不开

**故障链路**：
1. `openWorkspace()` → `location.hash = "workspace@server"`
2. `loadReactForVersion()` → 加载 React SPA，`__MUTBOT_CONTEXT__` 只传 `{ remote, wsBase }`
3. React SPA `App.tsx` → `location.hash.replace(/^#\/?/, "")` → `"workspace@server"`
4. `wss.find(w => w.name === wsName)` → 匹配失败
5. `exitWorkspace()` → 回到 landing

**修复方案**：

**mutbot.ai 侧**：
- `__MUTBOT_CONTEXT__` 增加 `workspace` 字段，传递剥离 `@serverLabel` 后的工作区名
- `openWorkspace` / backward compat 路径用 `replaceState` 设 hash（不创建历史条目，由 SPA 统一管理）

**mutbot 前端侧**（统一逻辑，不区分 remote/local）：
- `parseWorkspaceHash()` helper：读 hash 时用 `lastIndexOf("@")` 剥离后缀
- `getWorkspaceName()`：优先读 `__MUTBOT_CONTEXT__.workspace`，fallback 到 `parseWorkspaceHash()`
- 所有 hash 读取点统一使用上述 helper

### 问题二：浏览器历史管理

**设计**：landing（不论是 mutbot.ai Astro 页还是 mutbot 自带的 WorkspaceSelector）和 workspace 之间的导航，统一由 React SPA 管理。

**`exitWorkspace()`** = `history.back()`，不区分 remote/local。

**确保 landing 在历史中**：React SPA 初始加载时，如果 hash 非空（直接访问 URL），执行 `replaceState("/") + pushState(hash)` 确保历史结构为 `[..., /, /#ws@server]`。从 landing 点击 workspace 时 `location.hash = ws.name` 自然形成同样结构。

**mutbot.ai popstate 监听**：SPA 模式下（`app-mode` 类存在），`popstate` 时 `reload()` 恢复 Astro landing。这是 landing 页面自己的职责。

**mutbot 独立跑**：`history.back()` → hash 变空 → `hashchange` → `setWorkspace(null)` → 显示 WorkspaceSelector。无需 reload。

### 问题三：本地 dev 版本无法走 Level 1 路径

**目标**：`npm run dev` 启动 mutbot.ai 后，访问 `localhost:4321/v0.5.999/` 能得到本地 mutbot 的前端构建产物，行为与生产环境 `/v0.5.0/` 完全一致。

**方案**：Vite 插件 + 本地配置文件。

**`.dev.json`**（gitignore，仅本地存在）：
```json
{
  "localBuild": "D:/ai/mutbot/src/mutbot/web/frontend_dist",
  "version": "0.5.999"
}
```

**Vite 插件 `plugins/vite-dev-local.mjs` 职责**：
1. **Serve 静态文件**：`/v0.5.999/*` 请求从 `localBuild` 目录读取文件返回
2. **注入 versions.json 条目**：拦截 `/versions.json` 请求，解析 `localBuild/index.html` 提取 js/css 入口文件名，将 dev 条目注入返回的 JSON

**launcher.ts 零改动**：server welcome 报 `0.5.999` → `findVersion("0.5.999")` 命中注入的条目 → `loadReactForVersion` 从 `/v0.5.999/assets/...` 加载 → 与生产路径完全一致。

## 关键参考

### 源码
- `mutbot.ai/src/scripts/launcher.ts` — hash 解析、openWorkspace、loadReactForVersion、popstate 监听
- `mutbot.ai/astro.config.mjs` — Astro/Vite 配置，引入 dev-local 插件
- `mutbot.ai/plugins/vite-dev-local.mjs` — 本地 dev 版本 Vite 插件
- `mutbot/frontend/src/App.tsx` — exitWorkspace、parseWorkspaceHash、getWorkspaceName、历史管理
- `mutbot/frontend/src/lib/connection.ts` — isRemote、getWsUrl、__MUTBOT_CONTEXT__ 读取
- `mutbot/src/mutbot/web/routes.py:152-158` — welcome 事件（含 version）

### 相关规范
- `mutbot.ai/docs/specifications/feature-remote-server.md` — 多服务器设计规范

## 实施步骤清单

### 阶段一：mutbot.ai 改动 [✅ 已完成]

- [x] **Task 1.1**: `loadReactForVersion()` 中 `__MUTBOT_CONTEXT__` 增加 `workspace` 字段
  - 状态：✅ 已完成

- [x] **Task 1.2**: `openWorkspace` 改用 `replaceState` 设 hash（不创建历史条目）
  - 状态：✅ 已完成

- [x] **Task 1.3**: backward compat 路径同样改用 `replaceState`
  - 状态：✅ 已完成

- [x] **Task 1.4**: `init()` 中添加 `popstate` 监听，app-mode 下 `reload()` 恢复 Astro landing
  - 状态：✅ 已完成

### 阶段二：mutbot 前端 — 统一逻辑，零 isRemote [✅ 已完成]

- [x] **Task 2.1**: 新增 `parseWorkspaceHash()` + `getWorkspaceName()` helper
  - `parseWorkspaceHash()`：用 `lastIndexOf("@")` 剥离后缀
  - `getWorkspaceName()`：优先 `__MUTBOT_CONTEXT__.workspace`，fallback 到 hash
  - 状态：✅ 已完成

- [x] **Task 2.2**: 更新所有 hash 读取点，统一使用新 helper
  - 初始加载 → `getWorkspaceName()`
  - `onHashChange` 监听器 → `parseWorkspaceHash()`
  - pending 状态显示 → `getWorkspaceName()`
  - 状态：✅ 已完成

- [x] **Task 2.3**: `exitWorkspace()` 统一为 `history.back()`，不区分模式
  - 状态：✅ 已完成

- [x] **Task 2.4**: 初始加载有 hash 时，`replaceState + pushState` 确保 landing 在历史中
  - 不区分 remote/local，统一处理
  - 状态：✅ 已完成

- [x] **Task 2.5**: workspace selector 写 hash 不再区分模式
  - `onSelect` / `onCreated` 中 `location.hash = ws.name` 对所有模式统一
  - 状态：✅ 已完成

- [x] **Task 2.6**: workspace 未找到时统一走 `exitWorkspace()`
  - 状态：✅ 已完成

### 阶段三：mutbot.ai — 本地 dev 版本支持 [✅ 已完成]

- [x] **Task 3.1**: `.gitignore` 增加 `.dev.json`
  - 状态：✅ 已完成

- [x] **Task 3.2**: 编写 Vite 插件 `plugins/vite-dev-local.mjs`
  - serve `/v{version}/*` 从 localBuild 目录
  - 拦截 `/versions.json` 注入 dev 条目（解析 index.html 提取 entry）
  - `.dev.json` 不存在时插件为空操作
  - 状态：✅ 已完成

- [x] **Task 3.3**: `astro.config.mjs` 引入 Vite 插件
  - 状态：✅ 已完成

### 阶段四：验证 [待开始]

- [ ] **Task 4.1**: 验证完整流程
  - mutbot.ai landing → 选 workspace → Level 1 加载 → workspace 正确打开
  - F5 刷新 → 重新连接正确
  - 关闭 workspace → 回到 mutbot.ai landing
  - 从 workspace 点浏览器后退 → 回到 landing
  - 直接访问 `/#ws@server` → 正确打开，后退回到 landing
  - 复制 URL 新标签页打开 → 正常工作
  - mutbot 独立跑：选 workspace → 关闭 → 回到 WorkspaceSelector
  - mutbot 独立跑：直接访问 `/#ws` → 后退 → 回到 WorkspaceSelector
  - 状态：⏸️ 待开始

## 当前进度与待解决问题

### 已完成
- 问题一（hash 解析）和问题三（dev 版本）已实施完成并验证通过
- 问题二（历史管理）大部分场景已正常：
  - landing → 选 workspace → 关闭 → 回 landing ✓
  - landing → 选 workspace → 后退 → 回 landing ✓
  - 后退后前进 → 重新加载 workspace ✓
  - 刷新 → 正常 ✓

### 待解决
- **直接访问 `/#ws@server` 后点浏览器后退 → 退到空页面**

**根因分析（CDP 调试确认）**：

Chrome 对页面初始加载时立即执行的 `replaceState + pushState` 做了反劫持处理：
- `main.tsx` 在模块顶层执行 `replaceState("/") + pushState("#ws")`
- Chrome 将这些条目视为"同一个初始导航"的一部分
- 用户点后退时，Chrome 直接跳回上一个"真实"导航（`chrome://newtab` 或上一个页面），跳过所有 pushState 条目
- 编程式 `history.back()` 不受此限制（正常停在 `/`）

**CDP 调试证据**：
- `Page.frameStartedNavigating url=chrome://new-tab-page/` — 后退直接跳到 newtab
- 没有 popstate 事件触发
- `Console: [NAV] beforeunload` — 页面直接被卸载

**影响范围**：纯 mutbot（`localhost:8741`）和 mutbot.ai（`localhost:4321`）均受影响。

**修复方向**：不能在初始加载时立即做 `replaceState + pushState`。需要改用其他策略确保后退能回到 landing。

### 调试辅助
- `python -m mutbot.cli.cdp_debug` — Chrome CDP 远程调试 CLI（详见 `mutbot/docs/specifications/bugfix-chrome-cdp-debug.md`）

## 测试验证

（手动验证阶段填写）
