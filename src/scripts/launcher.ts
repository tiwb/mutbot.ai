/**
 * Launcher — mutbot.ai 连接本地 MutBot 的核心逻辑。
 *
 * 流程：
 * 1. 并行：fetch /versions.json + WebSocket ws://localhost:8741/ws/app
 * 2. 连接成功 → workspace.list → 填充列表 + 显示 New Workspace
 * 3. 打开工作区时版本匹配 → Level 1（动态加载 React）或 Level 3（重定向 localhost）
 * 4. 连接失败 → 显示安装引导 + Level 3 链接
 */

const MUTBOT_WS = "ws://localhost:8741/ws/app";
const MUTBOT_LOCAL = "http://localhost:8741";
const CONNECT_TIMEOUT = 3000;

// ---------------------------------------------------------------------------
// 版本信息
// ---------------------------------------------------------------------------

interface VersionEntry {
  version: string;
  entry: { js: string; css: string };
}

interface VersionsJson {
  latest: string;
  versions: VersionEntry[];
}

let localVersion: string | null = null;
let versionsData: VersionsJson | null = null;

function findVersion(version: string): VersionEntry | undefined {
  return versionsData?.versions.find((v) => v.version === version);
}

// ---------------------------------------------------------------------------
// RPC 通信
// ---------------------------------------------------------------------------

interface RpcConnection {
  call<T>(method: string, params?: Record<string, unknown>): Promise<T>;
  close(): void;
}

let rpcNextId = 1;

function connectLocal(): Promise<RpcConnection | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        resolve(null);
      }
    }, CONNECT_TIMEOUT);

    const ws = new WebSocket(MUTBOT_WS);
    const pending = new Map<
      string,
      { resolve: (v: unknown) => void; reject: (e: Error) => void }
    >();

    ws.onopen = () => {
      if (resolved) return;
      clearTimeout(timer);
      resolved = true;

      const rpc: RpcConnection = {
        call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
          return new Promise((res, rej) => {
            const id = String(rpcNextId++);
            pending.set(id, {
              resolve: res as (v: unknown) => void,
              reject: rej,
            });
            ws.send(JSON.stringify({ type: "rpc", id, method, params }));
          });
        },
        close() {
          ws.close();
        },
      };
      resolve(rpc);
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string);
        // 捕获 welcome 事件中的版本号
        if (msg.type === "event" && msg.event === "welcome") {
          const data = msg.data as { version?: string };
          if (data.version) {
            localVersion = data.version;
          }
        }
        if (msg.type === "rpc_result") {
          const p = pending.get(msg.id);
          if (p) {
            pending.delete(msg.id);
            p.resolve(msg.result);
          }
        } else if (msg.type === "rpc_error") {
          const p = pending.get(msg.id);
          if (p) {
            pending.delete(msg.id);
            p.reject(new Error(msg.error?.message || "RPC error"));
          }
        }
      } catch {
        // ignore
      }
    };

    ws.onerror = () => {
      if (!resolved) {
        clearTimeout(timer);
        resolved = true;
        resolve(null);
      }
    };
  });
}

// ---------------------------------------------------------------------------
// DOM 操作
// ---------------------------------------------------------------------------

interface Workspace {
  id: string;
  name: string;
  project_path: string;
  last_accessed_at?: string;
}

const MAX_VISIBLE = 5;

interface DirEntry {
  name: string;
  type: string;
}

interface BrowseResult {
  path: string;
  parent: string | null;
  entries: DirEntry[];
  error?: string;
}

function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function shortenPath(path: string): string {
  return path
    .replace(/^[A-Z]:\\Users\\[^\\]+/, "~")
    .replace(/^\/home\/[^/]+/, "~")
    .replace(/^\/Users\/[^/]+/, "~");
}

function redirectToLocal(workspaceName?: string) {
  const url = workspaceName
    ? `${MUTBOT_LOCAL}/#${workspaceName}`
    : MUTBOT_LOCAL;
  window.location.href = url;
}

// ---------------------------------------------------------------------------
// 动态加载 React 前端
// ---------------------------------------------------------------------------

/** 打开工作区 — 所有路由决策在此发生 */
function openWorkspace(name: string) {
  if (localVersion && findVersion(localVersion)) {
    location.hash = name;
    loadReactForVersion(localVersion);
  } else {
    redirectToLocal(name);
  }
}

/** 动态加载指定版本的 React 前端（从版本化子目录） */
function loadReactForVersion(version: string) {
  const ver = findVersion(version);
  if (!ver) {
    window.location.href = `${MUTBOT_LOCAL}/${location.hash}`;
    return;
  }

  const base = `/v${ver.version}/`;

  // 加载 CSS
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `${base}${ver.entry.css}`;
  document.head.appendChild(link);

  // 隐藏 landing，显示 app
  document.documentElement.classList.add("app-mode");

  // 加载 React 入口（ES module，import 自动相对于模块 URL 解析）
  const script = document.createElement("script");
  script.type = "module";
  script.src = `${base}${ver.entry.js}`;
  document.head.appendChild(script);
}

// ---------------------------------------------------------------------------
// 右键菜单（workspace 删除）
// ---------------------------------------------------------------------------

/** 当前活跃的右键菜单，用于关闭 */
let activeContextMenu: HTMLElement | null = null;

function closeContextMenu() {
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
  }
}

function showWorkspaceContextMenu(
  e: MouseEvent,
  ws: Workspace,
  rpc: RpcConnection,
  onRemoved: (wsId: string) => void,
) {
  e.preventDefault();
  closeContextMenu();

  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu.style.top = `${e.clientY}px`;
  menu.style.left = `${e.clientX}px`;
  menu.innerHTML = `
    <button class="ctx-menu-item ctx-menu-danger">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      </svg>
      <span>Remove</span>
    </button>`;

  document.body.appendChild(menu);
  activeContextMenu = menu;

  // 边界检测
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 4}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 4}px`;

  menu.querySelector(".ctx-menu-item")!.addEventListener("click", async () => {
    closeContextMenu();
    if (!confirm(`Remove workspace "${ws.name}" from list?`)) return;
    try {
      await rpc.call("workspace.remove", { workspace_id: ws.id });
      onRemoved(ws.id);
    } catch {
      // 静默处理
    }
  });

  // 点击外部或 Escape 关闭
  const closeHandler = (ev: PointerEvent) => {
    if (!menu.contains(ev.target as Node)) {
      closeContextMenu();
      document.removeEventListener("pointerdown", closeHandler);
    }
  };
  const escHandler = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      closeContextMenu();
      document.removeEventListener("keydown", escHandler);
    }
  };
  // 延迟一帧注册，避免立即触发
  requestAnimationFrame(() => {
    document.addEventListener("pointerdown", closeHandler);
    document.addEventListener("keydown", escHandler);
  });
}

// ---------------------------------------------------------------------------
// 状态更新
// ---------------------------------------------------------------------------

function setConnecting() {
  const wsArea = document.getElementById("ws-area")!;
  wsArea.innerHTML = `<p class="ws-status connecting">Connecting to MutBot...</p>`;
}

function setDisconnected() {
  const wsArea = document.getElementById("ws-area")!;

  if (isMobile()) {
    wsArea.innerHTML = `
      <div class="ws-status mobile-hint">
        <p><strong>MutBot runs on your PC.</strong></p>
        <p>Install it on a desktop computer, then use this page to connect remotely.</p>
      </div>`;
  } else {
    wsArea.innerHTML = `
      <p class="ws-status disconnected">Run MutBot locally to get started. Try<a href="#" id="ws-retry" class="ws-retry">Reconnect</a>
      or<a href="http://localhost:8741" class="ws-action">Goto Local MutBot</a>.</p>`;
    document.getElementById("ws-retry")!.addEventListener("click", (e) => {
      e.preventDefault();
      retryConnect();
    });
  }
}

async function retryConnect() {
  setConnecting();
  const rpc = await connectLocal();
  if (!rpc) {
    setDisconnected();
    return;
  }
  try {
    const workspaces = await rpc.call<Workspace[]>("workspace.list");
    showWorkspaces(workspaces, rpc);
  } catch {
    setDisconnected();
  }
}

function showWorkspaces(workspaces: Workspace[], rpc: RpcConnection) {
  const wsArea = document.getElementById("ws-area")!;
  const newBtn = document.getElementById("new-ws-btn")!;

  // 本地 workspaces 副本（用于删除后更新）
  let wsList = [...workspaces];

  // 显示 New 按钮并绑定事件
  newBtn.classList.remove("hidden");
  // 移除旧的 listener（防止 retryConnect 重复绑定）
  const newBtnClone = newBtn.cloneNode(true) as HTMLElement;
  newBtn.replaceWith(newBtnClone);
  newBtnClone.addEventListener("click", () => openDirectoryPicker(rpc));

  function render() {
    if (wsList.length === 0) {
      wsArea.innerHTML = `
        <p class="ws-status empty">No workspaces yet — create one to get started</p>`;
      return;
    }

    const visible = wsList.slice(0, MAX_VISIBLE);
    const hasMore = wsList.length > MAX_VISIBLE;

    const items = visible
      .map(
        (ws) => `
      <button class="ws-item" data-name="${ws.name}" data-id="${ws.id}">
        <svg class="ws-item-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span class="ws-item-name">${ws.name}</span>
        <span class="ws-item-path">${shortenPath(ws.project_path)}</span>
      </button>`
      )
      .join("");

    const moreBtn = hasMore
      ? `<button class="ws-more" id="ws-more-btn">More...</button>`
      : "";

    wsArea.innerHTML = `<div class="ws-list">${items}</div>${moreBtn}`;

    // 工作区点击 — 通过 openWorkspace 做版本匹配决策
    wsArea.querySelectorAll(".ws-item").forEach((btn) => {
      const el = btn as HTMLElement;
      el.addEventListener("click", () => {
        const name = el.dataset.name;
        if (name) openWorkspace(name);
      });
      // 右键菜单
      el.addEventListener("contextmenu", (ev) => {
        const wsId = el.dataset.id!;
        const ws = wsList.find((w) => w.id === wsId);
        if (!ws) return;
        showWorkspaceContextMenu(ev as MouseEvent, ws, rpc, (removedId) => {
          wsList = wsList.filter((w) => w.id !== removedId);
          render();
        });
      });
    });

    // More... 弹出搜索对话框
    if (hasMore) {
      document.getElementById("ws-more-btn")!.addEventListener("click", () => {
        openWorkspaceSearch(wsList, rpc, (removedId) => {
          wsList = wsList.filter((w) => w.id !== removedId);
          render();
        });
      });
    }
  }

  render();
}

// ---------------------------------------------------------------------------
// 工作区搜索对话框
// ---------------------------------------------------------------------------

function openWorkspaceSearch(
  workspaces: Workspace[],
  rpc: RpcConnection,
  onRemoved: (wsId: string) => void,
) {
  let wsList = [...workspaces];

  const overlay = document.createElement("div");
  overlay.className = "ws-search-overlay";
  overlay.innerHTML = `
    <div class="ws-search-dialog">
      <div class="ws-search-input-row">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input class="ws-search-input" type="text" placeholder="Search workspaces..." />
      </div>
      <div class="ws-search-list"></div>
    </div>`;

  document.body.appendChild(overlay);

  const input = overlay.querySelector(".ws-search-input") as HTMLInputElement;
  const listDiv = overlay.querySelector(".ws-search-list") as HTMLDivElement;
  input.focus();

  function render(query: string) {
    const q = query.toLowerCase();
    const filtered = wsList.filter(
      (ws) =>
        !q ||
        ws.name.toLowerCase().includes(q) ||
        ws.project_path.toLowerCase().includes(q)
    );

    if (filtered.length === 0) {
      listDiv.innerHTML = `<div class="ws-search-empty">No matching workspaces</div>`;
      return;
    }

    listDiv.innerHTML = filtered
      .map(
        (ws) => `
      <button class="ws-search-item" data-name="${ws.name}" data-id="${ws.id}">
        <span class="ws-search-item-name">${ws.name}</span>
        <span class="ws-search-item-path">${shortenPath(ws.project_path)}</span>
      </button>`
      )
      .join("");

    listDiv.querySelectorAll(".ws-search-item").forEach((btn) => {
      const el = btn as HTMLElement;
      el.addEventListener("click", () => {
        const name = el.dataset.name;
        if (name) {
          overlay.remove();
          openWorkspace(name);
        }
      });
      // 右键菜单
      el.addEventListener("contextmenu", (ev) => {
        const wsId = el.dataset.id!;
        const ws = wsList.find((w) => w.id === wsId);
        if (!ws) return;
        showWorkspaceContextMenu(ev as MouseEvent, ws, rpc, (removedId) => {
          wsList = wsList.filter((w) => w.id !== removedId);
          onRemoved(removedId);
          render(input.value);
        });
      });
    });
  }

  render("");
  input.addEventListener("input", () => render(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") overlay.remove();
  });

  // 点击遮罩关闭
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

// ---------------------------------------------------------------------------
// New Workspace 对话框
// ---------------------------------------------------------------------------

let currentRpc: RpcConnection | null = null;

function openDirectoryPicker(rpc: RpcConnection) {
  currentRpc = rpc;

  const overlay = document.createElement("div");
  overlay.className = "dp-overlay";
  overlay.innerHTML = `
    <div class="dp-dialog">
      <h3 class="dp-title">New Workspace</h3>
      <div class="dp-name-row">
        <input id="dp-name" class="dp-name-input" type="text" placeholder="Workspace name (optional)" />
      </div>
      <div id="dp-path-bar" class="dp-path-bar">
        <button id="dp-path" class="dp-path" title="Click to enter path manually">Loading...</button>
      </div>
      <div id="dp-error" class="dp-error hidden"></div>
      <div id="dp-entries" class="dp-entries">
        <div class="dp-loading">Loading...</div>
      </div>
      <div class="dp-actions">
        <button id="dp-cancel" class="dp-btn-secondary">Cancel</button>
        <button id="dp-select" class="dp-btn-primary">Create</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  let currentPath = "";
  let parentPath: string | null = null;

  const nameInput = overlay.querySelector("#dp-name") as HTMLInputElement;
  const pathBar = overlay.querySelector("#dp-path-bar") as HTMLDivElement;
  const pathBtn = overlay.querySelector("#dp-path") as HTMLButtonElement;
  const entriesDiv = overlay.querySelector("#dp-entries") as HTMLDivElement;
  const errorDiv = overlay.querySelector("#dp-error") as HTMLDivElement;

  /** 切换为手动输入路径模式 */
  function enterManualInput() {
    pathBar.innerHTML = `
      <div class="dp-input-row">
        <input class="dp-input" type="text" value="${currentPath.replace(/"/g, "&quot;")}" />
        <button class="dp-btn-sm">Go</button>
      </div>`;
    const input = pathBar.querySelector(".dp-input") as HTMLInputElement;
    const goBtn = pathBar.querySelector(".dp-btn-sm") as HTMLButtonElement;
    input.focus();
    input.select();

    function commitPath() {
      const val = input.value.trim();
      if (val) {
        exitManualInput();
        browse(val);
      }
    }

    goBtn.addEventListener("click", commitPath);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commitPath();
      if (e.key === "Escape") exitManualInput();
    });
  }

  /** 退出手动输入，恢复按钮显示 */
  function exitManualInput() {
    pathBar.innerHTML = `<button id="dp-path" class="dp-path" title="Click to enter path manually">${currentPath || "..."}</button>`;
    const newBtn = pathBar.querySelector("#dp-path") as HTMLButtonElement;
    newBtn.addEventListener("click", () => enterManualInput());
  }

  // 初始绑定路径按钮点击
  pathBtn.addEventListener("click", () => enterManualInput());

  async function browse(path: string) {
    entriesDiv.innerHTML = `<div class="dp-loading">Loading...</div>`;
    errorDiv.classList.add("hidden");

    try {
      const result = await rpc.call<BrowseResult>("filesystem.browse", {
        path: path || undefined,
      });
      if (result.error) {
        errorDiv.textContent = result.error;
        errorDiv.classList.remove("hidden");
        return;
      }
      currentPath = result.path;
      parentPath = result.parent;
      // 更新路径按钮（可能处于手动输入状态）
      exitManualInput();

      // 更新 name placeholder
      const dirName = currentPath.split(/[/\\]/).filter(Boolean).pop() || "";
      nameInput.placeholder = dirName
        ? `Workspace name (default: ${dirName})`
        : "Workspace name (optional)";

      let html = "";
      if (parentPath) {
        html += `<button class="dp-entry" data-path="${parentPath}"><span class="dp-entry-icon">\u2B06</span><span>..</span></button>`;
      }
      for (const entry of result.entries) {
        const sep = currentPath.includes("\\") ? "\\" : "/";
        const fullPath = currentPath + sep + entry.name;
        html += `<button class="dp-entry" data-path="${fullPath}"><span class="dp-entry-icon">\uD83D\uDCC1</span><span>${entry.name}</span></button>`;
      }
      if (!html) {
        html = `<div class="dp-empty">No subdirectories</div>`;
      }
      entriesDiv.innerHTML = html;

      entriesDiv.querySelectorAll(".dp-entry").forEach((btn) => {
        btn.addEventListener("click", () => {
          const p = (btn as HTMLElement).dataset.path;
          if (p) browse(p);
        });
      });
    } catch (e) {
      errorDiv.textContent = String(e);
      errorDiv.classList.remove("hidden");
    }
  }

  // 初始加载
  browse("");

  // Cancel（只通过按钮关闭，不通过 overlay 点击）
  overlay.querySelector("#dp-cancel")!.addEventListener("click", () => {
    overlay.remove();
  });

  // Create
  overlay.querySelector("#dp-select")!.addEventListener("click", async () => {
    if (!currentPath) return;
    const selectBtn = overlay.querySelector("#dp-select") as HTMLButtonElement;
    selectBtn.disabled = true;
    selectBtn.textContent = "Creating...";
    errorDiv.classList.add("hidden");

    try {
      const params: Record<string, unknown> = { project_path: currentPath };
      const name = nameInput.value.trim();
      if (name) params.name = name;

      const ws = await rpc.call<Workspace & { error?: string }>(
        "workspace.create",
        params,
      );
      if (ws.error) {
        errorDiv.textContent = ws.error;
        errorDiv.classList.remove("hidden");
        selectBtn.disabled = false;
        selectBtn.textContent = "Create";
        return;
      }
      overlay.remove();
      openWorkspace(ws.name);
    } catch (e) {
      errorDiv.textContent = String(e);
      errorDiv.classList.remove("hidden");
      selectBtn.disabled = false;
      selectBtn.textContent = "Create";
    }
  });
}

// ---------------------------------------------------------------------------
// 平台检测 + Install 区域切换
// ---------------------------------------------------------------------------

function initPlatformTabs() {
  const tabs = document.querySelectorAll<HTMLButtonElement>(".install-tab");
  const panels = document.querySelectorAll<HTMLElement>(".install-panel");
  if (tabs.length === 0) return;

  // 自动检测平台，默认选中对应 Shell 标签
  const isWindows = /Win/i.test(navigator.platform) ||
    (navigator as any).userAgentData?.platform === "Windows";
  const defaultTab = isWindows ? "windows" : "unix";

  tabs.forEach((tab) => {
    const target = tab.dataset.target;
    if (target === defaultTab) {
      tab.classList.add("active");
    }
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      panels.forEach((p) => p.classList.add("hidden"));
      tab.classList.add("active");
      const panel = document.getElementById(`install-${target}`);
      if (panel) panel.classList.remove("hidden");
    });
  });

  // 显示默认面板
  panels.forEach((p) => p.classList.add("hidden"));
  const defaultPanel = document.getElementById(`install-${defaultTab}`);
  if (defaultPanel) defaultPanel.classList.remove("hidden");
}

function initCopyButtons() {
  document.querySelectorAll<HTMLButtonElement>(".copy-cmd-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const cmd = btn.dataset.cmd || "";
      await navigator.clipboard.writeText(cmd);

      const copyIcon = btn.querySelector(".icon-copy") as HTMLElement;
      const checkIcon = btn.querySelector(".icon-check") as HTMLElement;
      if (copyIcon && checkIcon) {
        copyIcon.classList.add("hidden");
        checkIcon.classList.remove("hidden");
        setTimeout(() => {
          checkIcon.classList.add("hidden");
          copyIcon.classList.remove("hidden");
        }, 2000);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------

async function init() {
  initPlatformTabs();
  initCopyButtons();

  const hashWs = location.hash.replace(/^#\/?/, "");

  setConnecting();

  // 并行获取：versions.json + WebSocket 连接
  const [versions, rpc] = await Promise.all([
    fetch("/versions.json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null) as Promise<VersionsJson | null>,
    connectLocal(),
  ]);
  versionsData = versions;

  if (!rpc) {
    // 有 hash 且无连接 → 移除 app-mode（如果有的话），显示 landing
    document.documentElement.classList.remove("app-mode");
    setDisconnected();
    return;
  }

  try {
    const workspaces = await rpc.call<Workspace[]>("workspace.list");

    // URL 已有 hash → 版本匹配后直接加载 React 或重定向
    if (hashWs) {
      const match = workspaces.find((ws) => ws.name === hashWs);
      if (match) {
        if (localVersion && findVersion(localVersion)) {
          // Level 1：动态加载 React
          loadReactForVersion(localVersion);
          return;
        } else {
          // Level 3：重定向到 localhost
          redirectToLocal(hashWs);
          return;
        }
      }
      // hash 指向不存在的 workspace，清空 hash，正常显示 landing
      location.hash = "";
      document.documentElement.classList.remove("app-mode");
    }

    showWorkspaces(workspaces, rpc);
  } catch {
    document.documentElement.classList.remove("app-mode");
    setDisconnected();
  }
}

// DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
