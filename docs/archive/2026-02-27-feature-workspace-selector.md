# 工作区选择器 — 设计规范

**状态**：✅ 已完成
**日期**：2026-02-27
**类型**：功能设计
**总体规划**：[feature-website-github-pages.md](feature-website-github-pages.md)

## 1. 背景

mutbot.ai 的主页即是工作区选择页面。检测到本地 MutBot 时直接列出工作区供用户选择和新建；未检测到时，工作区区域显示连接状态，同时始终展示安装引导。

本地 mutbot 前端（`localhost:8741`）也需要工作区选择器，与官网共享相同的 API 和相似的视觉设计，但不包含安装引导和宣传内容，也不需要 header/footer。两端代码独立维护（mutbot.ai 仓库 Astro + 原生 JS，mutbot 仓库 React）。

**涵盖范围**：

| 范围 | 说明 |
|------|------|
| mutbot.ai 工作区选择器 | 官网主页，含安装引导 |
| mutbot 本地工作区选择器 | 本地前端入口页 |
| 工作区 URL 方案 | 两端统一的 hash 路由 |
| Launcher 本地检测 | 覆盖 `feature-website-launch.md` Task 3.1 |
| 目录浏览 API | 新建工作区时选择本地目录 |

**依赖关系**：

| 依赖 | 文档 | 状态 |
|------|------|------|
| Landing Page 骨架 | [`feature-website-launch.md`](feature-website-launch.md) 阶段一、二 | ✅ 已完成 |

## 2. 设计方案

### 2.1 URL 方案

工作区通过 hash 路由标识，格式统一：

```
mutbot.ai/#<workspace_name>
localhost:8741/#<workspace_name>
```

**示例**：
- `mutbot.ai` （无 hash）→ 展示工作区选择器主页
- `mutbot.ai/#my-project` → 检测本地 MutBot → 自动重定向到 `localhost:8741/#my-project`
- `localhost:8741` （无 hash）→ 展示本地工作区选择器
- `localhost:8741/#my-project` → 直接进入该工作区

**选择 hash 路由的理由**：
- GitHub Pages 静态托管无需服务器端路由
- hash 不发送到服务器，完全由前端处理
- mutbot.ai 和 localhost 格式一致

**工作区名称约束**（作为 URL 标识符）：
- 必须唯一
- URL-safe：小写字母、数字、连字符（`[a-z0-9-]+`）
- 创建时自动从目录名 sanitize 生成，重名时追加数字后缀
- 用户后续可重命名（校验唯一性和格式）

### 2.2 页面布局

参考 VSCode / Visual Studio 的 Welcome 页面，采用左右两栏布局。移动端变为上下布局（右栏内容移至下方）。

#### mutbot.ai（已连接）

```
┌──────────────────────────────────────────────────────────────────────┐
│  [MutBot Logo]                                        [GitHub]      │
├─────────────────────────────────┬────────────────────────────────────┤
│                                 │                                    │
│  M u t B o t                    │  ┌─[🎯]─────────────────────────┐ │
│  Define Your AI                 │  │ You Define                   │ │
│                                 │  │ Shape your AI's behavior     │ │
│  RUN MUTBOT  [macOS] [Win] ...  │  └─────────────────────────────-┘ │
│  ─────────────────────          │  ┌─[🖥]─────────────────────────┐ │
│  ┌────────────────────────────┐ │  │ Control Your Machine         │ │
│  │ $ curl -LsSf ... | sh  📋 │ │  │ Run commands, edit files,    │ │
│  └────────────────────────────┘ │  │ manage projects directly     │ │
│                                 │  └──────────────────────────────┘ │
│  OPEN WORKSPACE                 │  ┌─[🔄]─────────────────────────┐ │
│  ─────────────────────          │  │ Always Evolving              │ │
│  📁 my-project     ~/dev/proj   │  │ Learns and adapts as you     │ │
│  📁 another-one    ~/dev/other  │  │ work                         │ │
│  📁 demo           ~/demo      │  └──────────────────────────────┘ │
│  📁 work-4         ~/dev/work4  │                                    │
│  📁 test-5         ~/dev/test5  │                                    │
│  More...                        │                                    │
│  📁+ New Workspace...           │                                    │
│                                 │                                    │
├─────────────────────────────────┴────────────────────────────────────┤
│  GitHub · Docs · MIT License                                         │
└──────────────────────────────────────────────────────────────────────┘
```

#### mutbot.ai（未连接 — 检测中 / 连接失败）

```
┌──────────────────────────────────────────────────────────────────────┐
│  [MutBot Logo]                                        [GitHub]      │
├─────────────────────────────────┬────────────────────────────────────┤
│                                 │                                    │
│  M u t B o t                    │  ┌─[🎯]─────────────────────────┐ │
│  Define Your AI                 │  │ You Define                   │ │
│                                 │  │ ...                          │ │
│  RUN MUTBOT  [macOS] [Win] ...  │  └──────────────────────────────┘ │
│  ─────────────────────          │  ┌─[🖥]─────────────────────────┐ │
│  ┌────────────────────────────┐ │  │ Control Your Machine         │ │
│  │ $ curl -LsSf ... | sh  📋 │ │  │ ...                          │ │
│  └────────────────────────────┘ │  └──────────────────────────────┘ │
│                                 │  ┌─[🔄]─────────────────────────┐ │
│  OPEN WORKSPACE                 │  │ Always Evolving              │ │
│  ─────────────────────          │  │ ...                          │ │
│  ⏳ Connecting to MutBot...     │  └──────────────────────────────┘ │
│  或：                           │                                    │
│  Could not connect. Run MutBot  │                                    │
│  locally to get started. Retry  │                                    │
│  🔗 Redirect To Local MutBot   │                                    │
│                                 │                                    │
├─────────────────────────────────┴────────────────────────────────────┤
│  GitHub · Docs · MIT License                                         │
└──────────────────────────────────────────────────────────────────────┘
```

注意：未连接时 "New Workspace..." **不可见**（不是 disabled），因为工作区是本地概念。"Redirect To Local MutBot" 仅在连接失败时可见。连接失败提示行末尾带蓝色 "Retry" 链接，点击重新尝试连接。

#### mutbot.ai（移动端）

移动端检测到非桌面平台时，Open Workspace 区域显示提示：

```
Open Workspace
─────────────────────
📱 MutBot runs on your PC.
   Install it on a desktop computer, then
   use this page to connect remotely.
```

移动端整体布局变为单列，右栏特性卡片移至左栏下方。

#### localhost:8741（本地前端）

无 header / footer / 右栏卡片，单列居中，仅保留品牌标题和工作区列表：

```
┌──────────────────────────────────────┐
│                                      │
│  M u t B o t                         │
│  Define Your AI                      │
│                                      │
│  WORKSPACES                    +New  │
│  ─────────────────────────────────── │
│  my-project     ~/dev/proj           │
│  another-one    ~/dev/other          │
│  demo           ~/demo               │
│  More...                             │
│                                      │
└──────────────────────────────────────┘
```

#### 布局要素对比

| 元素 | mutbot.ai | localhost |
|------|-----------|----------|
| Header（Logo + GitHub 链接） | ✅ | ❌ |
| 品牌标题 "MutBot" + tagline | ✅ | ✅ |
| Run MutBot 区域（标题行内嵌标签） | ✅（始终可见） | ❌ |
| Open Workspace → New Workspace | ✅（连接后才可见） | ✅（+New 按钮在标题栏） |
| Open Workspace → Open Local MutBot | ✅（仅连接失败时可见） | ❌ |
| 工作区列表 | ✅（最多 5 个 + More...） | ✅（最多 5 个 + More...） |
| 右栏特性卡片 | ✅ | ❌ |
| Footer | ✅ | ❌ |
| 响应式（移动端上下布局） | ✅ | ✅ |

### 2.3 左栏详细设计

#### 品牌区

大号 "MutBot" 文字 + "Define Your AI" tagline。两端一致。

mutbot.ai 使用 Tailwind：`text-6xl sm:text-7xl font-bold tracking-tight`，字体 Inter。localhost React 端的 `.ws-selector-title` 样式须与 mutbot.ai 保持视觉一致。

#### Run MutBot 区（仅 mutbot.ai，始终可见，位于 Open Workspace 之前）

提供多种方式启动本地 MutBot。脚本支持重复执行（已安装时直接启动，未安装时先安装再启动），因此不使用 "Install" 字样，而是 "Run MutBot"。

**标题行内嵌标签**：方式选择标签（macOS/Linux、Windows、uv、pip）与 "RUN MUTBOT" 标题在同一行，右对齐，节省垂直空间：

```
RUN MUTBOT             [macOS/Linux] [Windows] [uv] [pip]
─────────────────────────────────────────────────────────
┌──────────────────────────────────────────┐
│ $ curl -LsSf https://mutbot.ai/install.sh | sh   📋 │
└──────────────────────────────────────────┘
```

带醒目视觉样式（彩色左边框）。

**各标签对应命令**：

| 标签 | 命令 |
|------|------|
| macOS / Linux（默认，非 Windows） | `curl -LsSf https://mutbot.ai/install.sh \| sh` |
| Windows（默认，Windows） | `irm https://mutbot.ai/install.ps1 \| iex` |
| uv | `uvx mutbot` |
| pip | `pip install mutbot && python -m mutbot` |

默认根据 `navigator.platform` / `navigator.userAgentData` 检测平台，自动选中 macOS/Linux 或 Windows 标签。

#### Open Workspace 区（合并原 Start + Workspaces）

mutbot.ai 将 Start 和 Workspaces 合并为单一 "Open Workspace" 区域。localhost 暂保持 Start + Workspaces 分开（后续可统一）。

**已连接状态**：
- 工作区列表（最多 5 个，每项带 📁 文件夹图标）
- 超过 5 个时显示 "More..." 链接（蓝色）
- "New Workspace..." 按钮在列表最后（More... 之后），带 📁+ 图标
- "Redirect To Local MutBot" 不显示

**未连接状态**：
- New Workspace 不可见
- 断连提示（一行）+ Retry 链接（蓝色，同一行）
- "Redirect To Local MutBot" 链接

工作区列表按 `last_accessed_at` 降序排列（最近访问的在最上方）。后端 `workspace.list` 已排序返回。

每项显示：
- 📁 文件夹图标（SVG，灰色）
- 工作区名称（蓝色）
- 项目路径（简化显示，灰色）

**最多显示 5 个**。超过 5 个时，在列表末尾显示 **"More..."** 链接（蓝色，`#3b82f6`），点击弹出工作区搜索对话框。

**工作区搜索对话框**（类似 VSCode 的 Quick Open）：

```
┌──────────────────────────────────────────┐
│  🔍 Search workspaces...                 │
├──────────────────────────────────────────┤
│  my-project       ~/dev/proj             │
│  another-one      ~/dev/other            │
│  demo             ~/demo                 │
│  work-4           ~/dev/work4            │
│  test-5           ~/dev/test5            │
│  old-project      ~/dev/old              │
│  ...                                     │
└──────────────────────────────────────────┘
```

- 顶部搜索框，自动聚焦
- 按名称和路径模糊匹配过滤
- 列表最大高度 320px，超出滚动
- Escape 或点击遮罩关闭
- 点击工作区项 → 选择该工作区（mutbot.ai 重定向，localhost 加载）
- 样式与页面整体设计语言一致（暗色背景、圆角、阴影）

点击行为：
- mutbot.ai：重定向到 `localhost:8741/#<name>`
- localhost：更新 hash + 加载工作区

**各状态展示**：

| 状态 | 显示内容 |
|------|----------|
| 检测中（mutbot.ai） | "Connecting to MutBot..." + 加载动画 |
| 连接失败（mutbot.ai 桌面） | "Could not connect to local MutBot. Run MutBot locally to get started. [Retry]" + "Redirect To Local MutBot" 链接 |
| 连接失败（mutbot.ai 移动端） | "MutBot runs on your PC. Install it on a desktop computer, then use this page to connect remotely." |
| 已连接无工作区 | "No workspaces yet — create one to get started" |
| 已连接有工作区 | 工作区列表（最多 5 个 + More...） |

### 2.4 右栏特性卡片

右栏为竖排特性卡片，无标签页切换，图标在左侧，整体紧凑。卡片不可点击，纯展示。

**卡片布局**（每张）：

```
┌──────────────────────────────────┐
│ [图标]  标题                      │
│         一句话描述                │
└──────────────────────────────────┘
```

**内容**：

| 图标 | 标题 | 描述 |
|------|------|------|
| 🎯 | You Define | Shape your AI's behavior through natural conversation. Your preferences become its instincts. |
| 🖥 | Control Your Machine | Run commands, edit files, and manage your projects — AI that works directly on your computer. |
| 🔄 | Always Evolving | Built on the Python ecosystem. Extend capabilities with any PyPI package — if Python can do it, MutBot can too. |

图标使用 SVG（与当前 Landing Page 一致），不用 emoji。颜色延续现有风格（violet / sky / emerald）。

**localhost**：不显示右栏特性卡片，保持单列简洁布局。仅保留品牌标题 + WORKSPACES 列表（标题栏内嵌 +New 按钮）。

### 2.5 连接与通信：全部走 WebSocket RPC

网站与本地 MutBot 的所有通信通过单一 WebSocket 连接完成，不使用 REST：

```
ws://localhost:8741/ws/app
```

- **连接成功 = 检测通过**：WebSocket 握手成功即证明本地 MutBot 在运行，不需要单独的 health check
- **CORS 一次性校验**：WebSocket 仅在握手时检查 Origin，后续所有 RPC 调用无额外开销
- **统一协议**：与现有 `/ws/workspace/{id}` 共享 JSON-RPC 消息格式

**RPC 方法**：

| 方法 | 说明 |
|------|------|
| `workspace.list` | 列出所有工作区 |
| `workspace.create` | 创建工作区（参数：`project_path`，可选 `name`） |
| `filesystem.browse` | 列出指定目录的子目录（参数：`path`，空则返回主目录） |

**mutbot.ai 流程**：

```typescript
// src/scripts/launcher.ts

const MUTBOT_WS = "ws://localhost:8741/ws/app";

async function init() {
  const targetWs = location.hash.replace(/^#\/?/, '');

  // 连接 WebSocket — 连上即检测通过
  const rpc = await connectLocal();

  if (!rpc) {
    setDisconnected();
    return;
  }

  // 获取工作区列表
  const workspaces = await rpc.call("workspace.list");
  showWorkspaces(workspaces);
  showNewWorkspace();

  // 如果有目标工作区，直接重定向
  if (targetWs) {
    const match = workspaces.find(ws => ws.name === targetWs);
    if (match) {
      redirectToLocal(targetWs);
      return;
    }
  }
}

function connectLocal(): Promise<AppRpc | null> {
  return new Promise((resolve) => {
    const ws = new WebSocket(MUTBOT_WS);
    const timer = setTimeout(() => { ws.close(); resolve(null); }, 3000);
    ws.onopen = () => { clearTimeout(timer); resolve(new AppRpc(ws)); };
    ws.onerror = () => { clearTimeout(timer); resolve(null); };
  });
}

function redirectToLocal(workspaceName?: string) {
  const url = workspaceName
    ? `http://localhost:8741/#${workspaceName}`
    : "http://localhost:8741";
  window.location.href = url;
}
```

**localhost 流程**：同源 WebSocket 连接始终成功，直接调用 `workspace.list`。

### 2.6 mutbot 前端工作区路由（React）

`App.tsx` 启动逻辑从"自动加载第一个工作区"改为"hash 路由驱动"：

```typescript
function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const appRpcRef = useRef<AppRpc | null>(null);

  useEffect(() => {
    // 连接 /ws/app 获取工作区列表
    const ws = new WebSocket("ws://localhost:8741/ws/app");
    const rpc = new AppRpc(ws);
    appRpcRef.current = rpc;

    rpc.onReady(() => {
      rpc.call<Workspace[]>("workspace.list").then((wss) => {
        setWorkspaces(wss);

        const wsName = location.hash.replace(/^#\/?/, '');
        if (wsName) {
          const target = wss.find(w => w.name === wsName);
          if (target) {
            setWorkspace(target);
            return;
          }
        }
      });
    });

    return () => ws.close();
  }, []);

  // hash 变化监听
  useEffect(() => {
    const onHashChange = () => {
      const wsName = location.hash.replace(/^#\/?/, '');
      if (!wsName) { setWorkspace(null); return; }
      const target = workspaces.find(w => w.name === wsName);
      if (target) setWorkspace(target);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [workspaces]);

  if (!workspace) {
    return <WorkspaceSelector
      workspaces={workspaces}
      onSelect={(ws) => {
        location.hash = ws.name;
        setWorkspace(ws);
      }}
    />;
  }

  return <MainApp workspace={workspace} />;
}
```

### 2.7 新建工作区流程

1. 用户点击 "New Workspace"
2. 弹出目录选择对话框（由后端目录浏览 API 驱动）
3. 用户浏览并选择目录
4. 名称默认从目录名 sanitize 生成，显示在确认步骤中
5. 如果同名工作区已存在，提示用户重命名
6. 调用 `POST /api/workspaces { name, project_path }` 创建
7. 跳转到新工作区（mutbot.ai 重定向到 localhost，localhost 更新 hash）

**mutbot.ai**：仅在已连接本地时可见。通过 CORS 调用 localhost API。
**localhost**：始终可见。同源 API。

#### 为什么不用浏览器原生目录选择

浏览器的 `showDirectoryPicker()`（File System Access API）和 `<input webkitdirectory>` 均**不暴露绝对文件路径**——这是浏览器安全模型的刻意设计。`showDirectoryPicker()` 返回的 `FileSystemDirectoryHandle` 仅有 `.name`（目录名），无法获取完整路径（如 `/home/user/projects/my-app`）。而我们需要将绝对路径发送给 mutbot 后端来创建工作区。此外 `showDirectoryPicker()` 仅 Chrome/Edge 支持，Firefox/Safari 不支持。

因此采用后端目录浏览 API 方案。

#### 全局 WebSocket 端点（mutbot 后端新增）

目录浏览是交互式操作（用户频繁进入/返回目录），使用 WebSocket RPC 比多次 REST 请求更高效——CORS 只需在握手时校验一次，后续操作无额外开销。

新增全局 WebSocket 端点 `/ws/app`，用于工作区创建前的操作：

```
ws://localhost:8741/ws/app
```

与现有 `/ws/workspace/{id}` 共享 JSON-RPC 消息格式。

**RPC 方法**：

`filesystem.browse` — 列出目录内容：

```json
// 请求
{ "type": "rpc", "id": "1", "method": "filesystem.browse", "params": { "path": "/home/user" } }

// 响应
{ "type": "rpc_result", "id": "1", "result": {
    "path": "/home/user/projects",
    "parent": "/home/user",
    "entries": [
      { "name": "my-app", "type": "dir" },
      { "name": "website", "type": "dir" }
    ]
  }
}
```

- 仅返回子目录（不列出文件，简化 UI）
- `path` 为空时返回用户主目录（`Path.home()`）
- `parent` 字段用于"上级目录"导航

`workspace.create` — 创建工作区（从 REST 迁移至 RPC）：

```json
// 请求
{ "type": "rpc", "id": "2", "method": "workspace.create", "params": { "project_path": "/home/user/projects/my-app" } }

// 响应
{ "type": "rpc_result", "id": "2", "result": { "id": "...", "name": "my-app", "project_path": "..." } }
```

名称自动从路径末段 sanitize 生成。如果同名已存在，返回错误，由前端提示用户指定新名称（请求中可选传 `name` 字段）。

#### 目录选择器 UI

轻量对话框，实现尽量简单：

```
┌─ Select Project Directory ─────────────────────┐
│                                                 │
│  📂 /home/user/projects          [✏️ 手动输入]  │
│  ───────────────────────────────────            │
│  ⬆️ ..                                          │
│  📁 my-app                                      │
│  📁 website                                     │
│  📁 tools                                       │
│                                                 │
│                        [Cancel]  [Select]       │
└─────────────────────────────────────────────────┘
```

- 顶部：当前路径显示，点击可切换为文本输入框直接输入路径
- 列表：子目录，点击进入；`..` 返回上级
- 底部：Cancel / Select 按钮
- 通过 WebSocket RPC 调用 `filesystem.browse`，目录切换响应迅速

### 2.8 工作区模型变更（mutbot 后端）

当前 `Workspace.name` 无唯一性约束、无 URL 安全保证。不考虑已有数据的向后兼容，直接改为新规则：

```python
import re

def sanitize_workspace_name(name: str) -> str:
    """将名称转为 URL-safe slug。"""
    slug = re.sub(r'[^a-z0-9-]', '-', name.lower())
    slug = re.sub(r'-+', '-', slug).strip('-')
    return slug or 'workspace'

class WorkspaceManager:
    def create(self, name: str, project_path: str) -> Workspace:
        slug = sanitize_workspace_name(name)
        # 确保唯一
        base = slug
        counter = 1
        while any(ws.name == slug for ws in self._workspaces.values()):
            slug = f"{base}-{counter}"
            counter += 1
        # ... 使用 slug 作为 name 创建

    def get_by_name(self, name: str) -> Workspace | None:
        for ws in self._workspaces.values():
            if ws.name == name:
                return ws
        return None
```

### 2.9 工作区访问时间排序

Workspace 模型新增 `last_accessed_at` 字段（ISO 8601 UTC）。在以下时机更新：

- **创建时**：`last_accessed_at = now`（与 `created_at` 相同）
- **打开工作区 WebSocket 连接时**：`/ws/workspace/{id}` 握手成功后立即更新

`WorkspaceManager.list_all()` 按 `last_accessed_at` 降序返回（最近访问的在前）。旧数据无 `last_accessed_at` 时 fallback 到 `created_at`。

## 3. 待定问题

（无待定问题）

## 4. 实施步骤清单

### 阶段一：mutbot 后端准备 [✅ 已完成]
- [x] **Task 1.1**: 全局 WebSocket 端点 `/ws/app`
  - [x] 新增 `/ws/app` WebSocket 端点（复用现有 JSON-RPC 消息格式）
  - [x] WebSocket Origin 校验（接受 `https://mutbot.ai` 和 `localhost`）
  - [x] `workspace.list` RPC 方法
  - [x] `workspace.create` RPC 方法
  - [x] `filesystem.browse` RPC 方法（列出子目录，默认主目录）
  - 状态：✅ 已完成

- [x] **Task 1.2**: 工作区名称规范化
  - [x] `sanitize_workspace_name()` 函数
  - [x] `WorkspaceManager.create()` 名称 sanitize + 去重
  - [x] `WorkspaceManager.get_by_name()` 方法
  - 状态：✅ 已完成

### 阶段二：mutbot 本地工作区选择器 [✅ 已完成]
- [x] **Task 2.1**: WorkspaceSelector React 组件
  - [x] 左右两栏布局（移动端变上下）
  - [x] 左栏：品牌区 + Start + Workspaces
  - [x] 右栏：特性卡片（图标左侧，竖排）
  - [x] 暗色主题，无 header/footer
  - 状态：✅ 已完成

- [x] **Task 2.2**: App.tsx hash 路由改造
  - [x] 读取 `location.hash` 确定工作区
  - [x] 无 hash → 显示 WorkspaceSelector
  - [x] 有 hash → 直接加载对应工作区
  - [x] `hashchange` 事件监听
  - 状态：✅ 已完成

- [x] **Task 2.3**: 新建工作区 + 目录选择器
  - [x] 目录浏览器对话框（通过 `/ws/app` WebSocket RPC 调用 `filesystem.browse`）
  - [x] 选择目录 → 自动生成名称
  - [x] 同名检测 + 重命名提示
  - [x] 通过 RPC 调用 `workspace.create` 创建
  - [x] 创建后跳转到新工作区
  - 状态：✅ 已完成

### 阶段三：mutbot.ai 工作区选择器 [✅ 已完成]
- [x] **Task 3.1**: 页面布局重构
  - [x] `index.astro` 改为左右两栏布局（移动端上下）
  - [x] 左栏：品牌区 + Start + Workspaces + Install MutBot
  - [x] 右栏：特性卡片（图标左侧，竖排，紧凑）
  - [x] 保留 Header / Footer
  - [x] Install MutBot 区域：始终可见 + 醒目样式 + 平台切换标签
  - [x] 平台自动检测（默认选中当前平台）
  - 状态：✅ 已完成

- [x] **Task 3.2**: Launcher 连接逻辑
  - [x] `src/scripts/launcher.ts`：WebSocket 连接 + RPC 调用
  - [x] 初始状态：Workspaces 区域 "Connecting..." + 动画，New Workspace 不可见
  - [x] 连接成功 → `workspace.list` → 填充工作区列表 + 显示 New Workspace
  - [x] 连接失败（桌面）→ 引导安装并运行 MutBot
  - [x] 连接失败（移动端）→ 提示需在 PC 安装，移动端可远程操控
  - [x] Hash 路由处理（有 hash + 已连接 → 自动重定向）
  - 状态：✅ 已完成

- [x] **Task 3.3**: 新建工作区（跨域）
  - [x] 连接 `ws://localhost:8741/ws/app`（CORS 仅握手时校验）
  - [x] 复用目录选择器 UI（通过 WebSocket RPC 浏览目录）
  - [x] 创建后重定向到 `localhost:8741/#<name>`
  - 状态：✅ 已完成

### 阶段四：安装脚本 [✅ 已完成]
- [x] **Task 4.1**: 编写安装脚本
  - [x] 已独立为 [`feature-install-scripts.md`](feature-install-scripts.md) 重新设计并实施
  - 状态：✅ 已完成

### 阶段五：工作区列表优化 + 启动方式重构 [✅ 已完成]- [x] **Task 5.1**: 后端 — 工作区访问时间排序
  - [x] Workspace 模型新增 `last_accessed_at` 字段
  - [x] `_workspace_to_dict` / `_workspace_from_dict` 包含新字段
  - [x] `WorkspaceManager.touch_accessed()` 方法
  - [x] `list_all()` 按 `last_accessed_at` 降序排列
  - [x] `routes.py` — `_workspace_dict` 包含新字段
  - [x] `routes.py` — `/ws/workspace/{id}` 连接时调用 `touch_accessed()`
  - 状态：✅ 已完成

- [x] **Task 5.2**: 两端工作区列表 — 最多 5 个 + More... 搜索对话框
  - [x] mutbot 前端（React）— WorkspaceSelector 只显示前 5 个
  - [x] mutbot 前端 — "More..." 按钮（蓝色）+ WorkspaceSearchDialog 组件
  - [x] mutbot.ai（vanilla JS）— showWorkspaces 只渲染前 5 个
  - [x] mutbot.ai — openWorkspaceSearch 搜索对话框
  - [x] "More..." 按钮使用蓝色（`#3b82f6`）
  - [x] 搜索对话框样式与页面整体设计语言一致
  - 状态：✅ 已完成

- [x] **Task 5.3**: mutbot.ai — "Run MutBot" 区域重构
  - [x] 区域标题从 "Install MutBot" 改为 "Run MutBot"
  - [x] 移动到 Start 区之前（品牌区之后）
  - [x] 标签从 [macOS/Linux] [Windows] 改为 [Shell] [uv] [pip]
  - [x] Shell 标签根据平台自动显示 curl 或 irm 命令
  - [x] uv 标签：`uvx mutbot`
  - [x] pip 标签：`pip install mutbot && python -m mutbot`
  - 状态：✅ 已完成

- [x] **Task 5.4**: 样式一致性修复
  - [x] 工作区搜索对话框样式与 mutbot.ai 页面一致（字体、颜色、圆角等）
  - [x] localhost React 端 `.ws-selector-title` 样式与 mutbot.ai 的 MutBot 标题保持视觉一致
  - 状态：✅ 已完成

### 阶段六：视觉细节优化 [✅ 已完成]

- [x] **Task 6.1**: mutbot.ai — 品牌标题字体修复
  - [x] 恢复为 `text-6xl sm:text-7xl font-bold tracking-tight`（与初始版本一致）
  - 状态：✅ 已完成

- [x] **Task 6.2**: mutbot.ai — 工作区列表图标 + New Workspace 位置调整
  - [x] 每个工作区项添加 📁 文件夹 SVG 图标（`.ws-item-icon`）
  - [x] "New Workspace..." 移至列表末尾（More... 之后），带 📁+ 图标
  - [x] New Workspace 仅在连接成功后显示（由 `showWorkspaces` 统一渲染）
  - [x] 空工作区时显示提示文字 + New Workspace 按钮
  - 状态：✅ 已完成

- [x] **Task 6.3**: mutbot.ai — 断连状态优化
  - [x] 断连提示同一行末尾添加蓝色 "Retry" 链接
  - [x] 点击 Retry 重新尝试 WebSocket 连接
  - [x] "Open Local MutBot" 改为 "Redirect To Local MutBot"
  - 状态：✅ 已完成

- [x] **Task 6.4**: CSS 补充
  - [x] `.ws-item-icon` 样式（灰色、不缩放）
  - [x] `.ws-new-item` 样式（灰色、hover 变亮）
  - [x] `.ws-retry` 样式（蓝色链接）
  - 状态：✅ 已完成

### 阶段七：本地前端简化 + 启动引导 [✅ 已完成]

- [x] **Task 7.1**: mutbot 本地 — 工作区选择器简化
  - [x] 移除右栏特性卡片（单列居中布局）
  - [x] 移除 Start 区，仅保留 WORKSPACES 区
  - [x] +New 按钮移入 WORKSPACES 标题栏（右对齐）
  - [x] 保留品牌标题（MutBot + tagline）
  - 状态：✅ 已完成

- [x] **Task 7.2**: mutbot — 启动后打印 mutbot.ai 引导链接
  - [x] `__main__.py` 使用 `uvicorn.Server` API 在启动消息后打印 `Open https://mutbot.ai to get started`
  - 状态：✅ 已完成

- [x] **Task 7.3**: mutbot.ai — "Always Evolving" 文案更新
  - [x] 描述从 "Learns and adapts..." 改为强调 Python 生态和 PyPI 可扩展性
  - 状态：✅ 已完成

## 5. 测试验证

### 单元测试（mutbot 后端）
- [x] `sanitize_workspace_name` 各种输入（中文、空格、特殊字符、纯符号）
- [x] 名称唯一性（重复名称自动加后缀）
- [x] `get_by_name` 查找
- [x] `/ws/app` WebSocket 连接 + Origin 校验
- [x] `workspace.list` RPC 方法
- [x] `workspace.create` RPC 方法（路径不存在时返回错误、同名时返回错误）
- [x] `filesystem.browse` RPC 方法（默认返回主目录、parent 导航正确）

### 手动测试
- [x] localhost 无 hash → 显示工作区选择器（两栏布局）
- [x] localhost `#my-project` → 直接进入工作区
- [x] localhost 选择工作区 → hash 更新 + 加载
- [x] localhost 新建工作区 → 目录选择器 → 创建 → 跳转
- [x] localhost 新建同名工作区 → 提示重命名
- [x] localhost 工作区 > 5 个时显示 "More..."（蓝色）→ 弹出搜索对话框
- [x] localhost 搜索对话框 → 输入关键词过滤 → 选择 → 进入工作区
- [x] mutbot.ai 页面加载 → "Run MutBot" 区域在 Start 之前可见
- [x] mutbot.ai Run MutBot 标签切换：Shell / uv / pip
- [x] mutbot.ai Shell 标签自动检测平台（macOS 显示 curl，Windows 显示 irm）
- [x] mutbot.ai 连接成功 → 工作区列表（按最近访问排序）+ New Workspace 出现
- [x] mutbot.ai 连接失败（桌面）→ 引导提示（不含 "install" 字样）
- [x] mutbot.ai 连接失败（移动端）→ PC 安装 + 远程操控提示
- [x] mutbot.ai 工作区 > 5 个时显示 "More..."（蓝色）→ 弹出搜索对话框
- [x] mutbot.ai 选择工作区 → 重定向到 localhost
- [x] mutbot.ai `#my-project` → 连接成功后自动重定向
- [x] mutbot.ai 新建工作区 → 目录选择器（CORS）→ 创建 → 重定向
- [x] mutbot.ai 搜索对话框样式与页面一致（字体、颜色）
- [x] 响应式：移动端左右变上下
- [x] Chrome / Firefox / Safari 各浏览器验证
