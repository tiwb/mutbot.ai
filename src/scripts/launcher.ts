/**
 * Launcher — mutbot.ai 连接本地 MutBot 的核心逻辑。
 *
 * 流程：
 * 1. 连接 ws://localhost:8741/ws/app
 * 2. 连接成功 → workspace.list → 填充列表 + 显示 New Workspace
 * 3. 连接失败 → 显示安装引导
 * 4. hash 路由 → 自动重定向到 localhost
 */

const MUTBOT_WS = "ws://localhost:8741/ws/app";
const MUTBOT_LOCAL = "http://localhost:8741";
const CONNECT_TIMEOUT = 3000;

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

  // 显示 New 按钮并绑定事件
  newBtn.classList.remove("hidden");
  newBtn.addEventListener("click", () => openDirectoryPicker(rpc));

  if (workspaces.length === 0) {
    wsArea.innerHTML = `
      <p class="ws-status empty">No workspaces yet — create one to get started</p>`;
    return;
  }

  const visible = workspaces.slice(0, MAX_VISIBLE);
  const hasMore = workspaces.length > MAX_VISIBLE;

  const items = visible
    .map(
      (ws) => `
    <button class="ws-item" data-name="${ws.name}">
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

  // 工作区点击
  wsArea.querySelectorAll(".ws-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = (btn as HTMLElement).dataset.name;
      if (name) redirectToLocal(name);
    });
  });

  // More... 弹出搜索对话框
  if (hasMore) {
    document.getElementById("ws-more-btn")!.addEventListener("click", () => {
      openWorkspaceSearch(workspaces);
    });
  }
}

// ---------------------------------------------------------------------------
// 工作区搜索对话框
// ---------------------------------------------------------------------------

function openWorkspaceSearch(workspaces: Workspace[]) {
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
    const filtered = workspaces.filter(
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
      <button class="ws-search-item" data-name="${ws.name}">
        <span class="ws-search-item-name">${ws.name}</span>
        <span class="ws-search-item-path">${shortenPath(ws.project_path)}</span>
      </button>`
      )
      .join("");

    listDiv.querySelectorAll(".ws-search-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = (btn as HTMLElement).dataset.name;
        if (name) {
          overlay.remove();
          redirectToLocal(name);
        }
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
// 目录选择器（跨域）
// ---------------------------------------------------------------------------

let currentRpc: RpcConnection | null = null;

function openDirectoryPicker(rpc: RpcConnection) {
  currentRpc = rpc;

  const overlay = document.createElement("div");
  overlay.className = "dp-overlay";
  overlay.innerHTML = `
    <div class="dp-dialog">
      <h3 class="dp-title">Select Project Directory</h3>
      <div class="dp-path-bar">
        <button id="dp-path" class="dp-path">Loading...</button>
      </div>
      <div id="dp-error" class="dp-error hidden"></div>
      <div id="dp-entries" class="dp-entries">
        <div class="dp-loading">Loading...</div>
      </div>
      <div class="dp-actions">
        <button id="dp-cancel" class="dp-btn-secondary">Cancel</button>
        <button id="dp-select" class="dp-btn-primary">Select</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  let currentPath = "";
  let parentPath: string | null = null;

  const pathBtn = overlay.querySelector("#dp-path") as HTMLButtonElement;
  const entriesDiv = overlay.querySelector("#dp-entries") as HTMLDivElement;
  const errorDiv = overlay.querySelector("#dp-error") as HTMLDivElement;

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
      pathBtn.textContent = currentPath;

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

  // Cancel
  overlay.querySelector("#dp-cancel")!.addEventListener("click", () => {
    overlay.remove();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Select
  overlay.querySelector("#dp-select")!.addEventListener("click", async () => {
    if (!currentPath) return;
    const selectBtn = overlay.querySelector("#dp-select") as HTMLButtonElement;
    selectBtn.disabled = true;
    selectBtn.textContent = "Creating...";
    errorDiv.classList.add("hidden");

    try {
      const ws = await rpc.call<Workspace & { error?: string }>(
        "workspace.create",
        { project_path: currentPath }
      );
      if (ws.error) {
        errorDiv.textContent = ws.error;
        errorDiv.classList.remove("hidden");
        selectBtn.disabled = false;
        selectBtn.textContent = "Select";
        return;
      }
      overlay.remove();
      redirectToLocal(ws.name);
    } catch (e) {
      errorDiv.textContent = String(e);
      errorDiv.classList.remove("hidden");
      selectBtn.disabled = false;
      selectBtn.textContent = "Select";
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

  const targetWs = location.hash.replace(/^#\/?/, "");

  setConnecting();

  const rpc = await connectLocal();

  if (!rpc) {
    setDisconnected();
    return;
  }

  try {
    const workspaces = await rpc.call<Workspace[]>("workspace.list");
    showWorkspaces(workspaces, rpc);

    // 有目标工作区 → 自动重定向
    if (targetWs) {
      const match = workspaces.find((ws) => ws.name === targetWs);
      if (match) {
        redirectToLocal(targetWs);
        return;
      }
    }
  } catch {
    setDisconnected();
  }
}

// DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
