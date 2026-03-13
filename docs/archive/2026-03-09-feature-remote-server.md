# 远程服务器连接 设计规范

**状态**：✅ 已完成
**日期**：2026-03-09
**类型**：功能设计
**范围**：仅 mutbot.ai（纯前端）。mutbot 自身的多服务器功能（后端代理/SSH 隧道）另行设计。

## 背景

mutbot.ai 当前只能连接 `localhost:8741`（硬编码在 `launcher.ts`）。用户可能在远程服务器上运行 mutbot，希望从 mutbot.ai 直接连接这些服务器并列出其工作区。

核心需求：
1. mutbot.ai 支持添加和管理多个服务器地址
2. 能列出各服务器上的工作区
3. 版本不匹配时合理处理（跳转或提示）
4. 服务器信息在纯前端（无后台）环境下持久化存储

## 设计方案

### 服务器数据模型

所有服务器条目完全平等，无特殊类型。

```typescript
interface ServerEntry {
  /** 唯一标识（crypto.randomUUID） */
  id: string;
  /** 用户可编辑的显示名称（唯一，用于 hash 路由） */
  label: string;
  /** 基础 URL，如 "http://192.168.1.100:8741" */
  url: string;
  /** 最近一次成功连接的 mutbot 版本号 */
  lastVersion?: string;
  /** 最近连接时间 ISO 字符串 */
  lastConnectedAt?: string;
}
```

**label 唯一性**：label 在服务器列表中必须唯一，添加/编辑时校验。初始化的 localhost 条目 label 默认为 "local"。

**label 字符限制**：仅允许字母、数字和连字符（`[a-zA-Z0-9-]`），因为 label 出现在 URL hash 中，需避免编码问题和 `@` 分隔符冲突。

### 存储方案

使用 `localStorage` 存储服务器列表：

```
key:   "mutbot:servers"
value: JSON.stringify(ServerEntry[])
```

**初始化**：localStorage 中无 `mutbot:servers` 时，自动创建一条 `localhost:8741` 条目。之后该条目与其他条目完全平等——可编辑、可删除。

**为什么用 localStorage**：
- 最简单可靠的纯前端持久化方案
- 数据量极小（几个服务器条目），无需 IndexedDB
- 浏览器原生同步（Chrome Sync Storage）仅限扩展程序，网页无法使用

**跨设备同步**：初版不做。如需要可通过导出/导入 JSON 实现。

### UI 设计

#### Landing 页面布局

替换当前 "2. Open Workspace" 区域。页面加载 → 并行探测所有服务器 → 显示结果。

所有服务器始终显示，无论在线还是离线。

**轻量 section header 风格**：服务器不用卡片包裹，只做一行分组标题 + 扁平工作区列表。工作区项复用现有 `.ws-item` 样式，视觉上与之前单服务器时几乎一致，只多了服务器名作为分隔。如果只有一个服务器且在线，可省略 header 直接显示工作区列表。

```
  Servers                        [+ Add]
─────────────────────────────────────────
  🖥️ local (localhost:8741)      v0.5.2   [hover: +]
    project-alpha
    project-beta

  🖥️ office (10.0.1.50:8741)
    Cannot connect. Try opening directly →

  🖥️ home (myhost:8741)
```

每个服务器 section：
- **header 行**：电脑图标（颜色表示状态） + 标签名（地址） + 版本号。hover 时右侧出现 "+" 按钮（新建工作区）
- **在线**：header 下方直接展开工作区列表（复用现有 `.ws-item` 样式）
- **离线**：header 下方显示"无法连接" + "尝试直接打开"链接
- **连接中**：header 与离线相同布局，仅图标颜色/动画不同，无额外文字

**状态图标**：使用电脑/显示器 SVG 图标，通过 stroke 颜色表示三态：
- **灰色**（`#737373`）：未连接/离线，静态
- **黄色闪烁**（`#eab308`）：连接中，脉冲动画
- **绿色**（`#22c55e`）：在线，静态

图标大小固定（14×14），位置不变，只变颜色和动画，避免状态切换时的 DOM 闪烁。连接中期间 body 区域为空（图标闪烁已足够暗示连接中），版本号在连接成功后直接出现。

#### 空状态

用户删除所有服务器后，列表区域显示一行提示文字引导用户添加服务器（[+ Add] 按钮始终在标题行可用）。

#### 离线服务器的交互

所有服务器离线时的提示统一，不区分 localhost 和远程：
- 提示"无法连接"
- 提供"尝试直接打开"按钮 → Level 3 重定向到 `${server.url}/`
- WebSocket 连接失败不等于服务器不存在（可能是浏览器安全限制）

#### 添加服务器对话框

点击 [+ Add] 弹出：
- **地址输入**：`host:port` 格式，默认端口 8741
- **名称输入**：可选，默认从地址生成
- **测试连接**按钮：尝试 WebSocket 握手，成功显示版本号，失败提示但仍允许保存
- **保存**按钮

#### 服务器管理

右键菜单或齿轮按钮：
- Edit — 修改名称/地址
- Remove — 删除
- Reconnect — 重新连接

#### 排序

按添加顺序排列。后续版本可支持手动拖拽排序。

### 连接逻辑

#### 多服务器并行探测

页面加载时，检查 hash：

- **hash 有值**（如 `#myproject@office`）：直接连接目标服务器，跳过探测，进入 React SPA 加载流程
- **hash 无值**（Landing 页面）：对 localStorage 中所有服务器并行发起 WebSocket 探测

探测连接是临时的，用于获取服务器状态和工作区列表。用户选择工作区后：
1. 关闭所有探测连接
2. 设置 `location.hash = workspace@server`
3. 页面 reload → 进入上述"hash 有值"分支 → 只连一个服务器

这样 React SPA 阶段始终只有一个服务器连接，不存在多连接管理问题。

```typescript
function getWsUrl(server: ServerEntry): string {
  const url = new URL(server.url);
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${url.host}/ws/app`;
}
```

每个服务器独立管理连接状态：`connecting` → `online` / `offline`。

**探测统一用 WebSocket**，不使用 `/api/health`。连接成功 + 收到 welcome 事件（含版本号）= 在线。

#### 版本匹配与加载

打开工作区时：

1. 服务器在线 + 版本在 `versions.json` 中有匹配 → **Level 1**：动态加载对应版本 React SPA
2. 服务器在线 + 版本无匹配 → **Level 3**：重定向到 `${server.url}/#${workspace}`
3. 服务器离线 → Level 3 重定向（尝试跳转）

**Level 3 重定向使用 `location.replace()`**（非 `location.href`），不在浏览器历史中留记录，避免后退按钮死循环。

**切换服务器时**：直接 `location.reload()`。React SPA 没有卸载机制，reload 最简单可靠。

#### Hash 路由

格式：`#workspaceName@serverLabel`

```
#myproject@office   → "office" 服务器上的 "myproject" 工作区
#myproject@local    → "local" 服务器上的 "myproject" 工作区
#myproject          → 无 @，向后兼容：按顺序在所有在线服务器中查找第一个匹配的工作区
```

解析逻辑：以最后一个 `@` 分割。workspace name 和 server label 的字符集均为 `[a-zA-Z0-9-]`，不含 `@`，分割无歧义，且无需 URL 编码。

**字符集约束**：
- **workspace name**：由 mutbot 后端 `sanitize_workspace_name()` 保证为 `[a-z0-9-]`
- **server label**：前端校验，仅允许 `[a-zA-Z0-9-]`（添加/编辑时检查）

`__MUTBOT_CONTEXT__` 注入时使用实际服务器地址：

```typescript
(window as any).__MUTBOT_CONTEXT__ = {
  remote: true,
  wsBase: `${wsProtocol}//${server.host}`,  // 动态，非硬编码
};
```

### CORS 与网络安全

mutbot 后端 WebSocket 已全面开放 CORS，允许任意跨站连接。

**Mixed Content 限制**（HTTPS → ws://）：
- **localhost**：Chrome/Edge 放行（特例），Firefox/Safari 阻止
- **远程 ws://**：所有浏览器阻止
- **远程 wss://**：正常工作（需服务器配 TLS）

**处理策略**：尝试连接，失败时标记为"无法连接"。用户仍可通过 Level 3 重定向访问（浏览器允许页面跳转到 HTTP 地址）。

## 关键参考

### 源码
- `mutbot.ai/src/scripts/launcher.ts` — 核心连接逻辑，硬编码 `localhost:8741`（L11-12），RPC 通信（L47-123），工作区列表（L325-406），React 动态加载（L183-212）
- `mutbot.ai/src/components/Landing.astro` — Landing 页面 HTML，工作区列表区域（L114-123）
- `mutbot.ai/src/styles/global.css` — 工作区 UI 样式
- `mutbot.ai/public/versions.json` — 版本清单
- `mutbot/frontend/src/lib/connection.ts` — mutbot 前端的动态 URL 解析（`__MUTBOT_CONTEXT__`）

### 相关规范
- `mutbot.ai/docs/specifications/feature-website-github-pages.md` — 整体架构
- `mutbot.ai/docs/specifications/feature-builtin-frontend.md` — Level 1/3 加载策略，版本匹配逻辑
- `mutbot.ai/docs/archive/2026-02-27-feature-workspace-selector.md` — 工作区选择器设计（已归档）
- `mutbot/docs/specifications/feature-openid-auth.md` — OpenID 认证（含 mutbot.ai 跨域认证流程）

## 实施步骤清单

### 阶段一：数据层 + 连接逻辑 [✅ 已完成]

- [x] **Task 1.1**: localStorage 服务器列表管理
  - [x] `ServerEntry` 接口定义
  - [x] 读取/保存/初始化逻辑（空时自动创建 localhost:8741）
  - [x] 增删改操作函数
  - [x] label 唯一性和字符集校验（`[a-zA-Z0-9-]`）
  - 状态：✅ 已完成

- [x] **Task 1.2**: 多服务器并行连接
  - [x] `connectServer(server)` 替代现有 `connectLocal()`
  - [x] 并行探测所有服务器，每个独立管理 `connecting` → `online` / `offline` 状态
  - [x] 复用现有 RPC 通信逻辑（welcome 事件获取版本号、workspace.list 等）
  - 状态：✅ 已完成

- [x] **Task 1.3**: Hash 路由解析
  - [x] `#workspace@server` 格式的解析和生成
  - [x] hash 有值时直接连接目标服务器，跳过探测
  - [x] 无 `@` 时的向后兼容（查找第一个匹配工作区）
  - [x] 未找到 server label 时回退到 Landing 页面
  - 状态：✅ 已完成

### 阶段二：UI 改造 [✅ 已完成]

- [x] **Task 2.1**: Landing 页面服务器列表
  - [x] 替换现有 "2. Open Workspace" 区域为按服务器分组的布局
  - [x] 轻量 section header（电脑图标三态颜色 + label + 地址 + 版本号）
  - [x] 在线服务器：展开工作区列表（复用现有工作区渲染逻辑）
  - [x] 离线服务器：统一"无法连接"提示 + "Open directly" 链接
  - [x] 连接中：电脑图标黄色脉冲，body 为空
  - [x] 空状态：提示用户添加服务器
  - [x] 单服务器在线时省略 header，退化为之前的视觉
  - 状态：✅ 已完成

- [x] **Task 2.2**: 添加服务器对话框
  - [x] 地址输入（host:port，默认端口 8741）
  - [x] 名称输入（可选，默认从地址生成）
  - [x] 测试连接按钮
  - [x] 保存按钮（校验 label 唯一性和字符集）
  - 状态：✅ 已完成

- [x] **Task 2.3**: 服务器编辑和删除
  - [x] 右键菜单（Edit / Remove / Reconnect）
  - [x] 编辑对话框（复用添加对话框）
  - [x] 删除确认
  - 状态：✅ 已完成

### 阶段三：工作区操作适配 [✅ 已完成]

- [x] **Task 3.1**: 打开工作区流程适配
  - [x] `openWorkspace()` 接收 server 参数
  - [x] 版本匹配 → Level 1 动态加载（`__MUTBOT_CONTEXT__.wsBase` 使用实际服务器地址）
  - [x] 版本不匹配或离线 → Level 3 重定向（使用 `location.replace()` 避免后退死循环）
  - 状态：✅ 已完成

- [x] **Task 3.2**: 新建工作区适配
  - [x] hover 时 "+" 按钮绑定到对应服务器的 RPC 连接
  - [x] 目录浏览使用该服务器的 `filesystem.browse` RPC
  - 状态：✅ 已完成

- [x] **Task 3.3**: 工作区搜索和右键菜单适配
  - [x] 搜索对话框传入对应服务器的 RPC 连接
  - [x] 工作区右键删除使用对应服务器的 RPC 连接
  - 状态：✅ 已完成

### 阶段四：样式 [✅ 已完成]

- [x] **Task 4.1**: 服务器 section 和新增 UI 的 CSS 样式
  - [x] 轻量 section header 样式（无背景/边框）
  - [x] 电脑图标三态颜色（灰/黄闪烁/绿）
  - [x] hover 显示 "+" 按钮
  - [x] 添加/编辑对话框样式
  - [x] 空状态、离线状态样式
  - 状态：✅ 已完成

## 测试验证

手动测试通过：多服务器列表显示、添加/编辑/删除服务器、工作区打开（Level 1/Level 3）、hash 路由、后退按钮、状态图标切换。
