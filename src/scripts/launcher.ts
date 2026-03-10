/**
 * Launcher — mutbot.ai 多服务器连接核心逻辑。
 *
 * 流程：
 * 1. 从 localStorage 读取服务器列表（首次访问自动初始化 localhost:8741）
 * 2. 检查 hash：
 *    - 有 hash（#workspace@server）→ 直接连接目标服务器 → Level 1 或 Level 3
 *    - 无 hash → Landing 页面：并行探测所有服务器 → 显示服务器卡片 + 工作区列表
 * 3. 用户选择工作区 → 设置 hash → reload 进入单连接模式
 */

const CONNECT_TIMEOUT = 3000;
const STORAGE_KEY = "mutbot:servers";
const LABEL_PATTERN = /^[a-zA-Z0-9-]+$/;

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

let versionsData: VersionsJson | null = null;

function findVersion(version: string): VersionEntry | undefined {
  return versionsData?.versions.find((v) => v.version === version);
}

// ---------------------------------------------------------------------------
// 服务器数据模型 + localStorage
// ---------------------------------------------------------------------------

interface ServerEntry {
  id: string;
  label: string;
  url: string;
  lastVersion?: string;
  lastConnectedAt?: string;
}

function loadServers(): ServerEntry[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    // 首次访问：初始化 localhost
    const initial: ServerEntry[] = [
      {
        id: crypto.randomUUID(),
        label: "local",
        url: "http://localhost:8741",
      },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    return initial;
  }
  try {
    return JSON.parse(raw) as ServerEntry[];
  } catch {
    return [];
  }
}

function saveServers(servers: ServerEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
}

function addServer(servers: ServerEntry[], entry: ServerEntry): ServerEntry[] {
  const updated = [...servers, entry];
  saveServers(updated);
  return updated;
}

function removeServer(servers: ServerEntry[], id: string): ServerEntry[] {
  const updated = servers.filter((s) => s.id !== id);
  saveServers(updated);
  return updated;
}

function updateServer(servers: ServerEntry[], id: string, changes: Partial<ServerEntry>): ServerEntry[] {
  const updated = servers.map((s) => (s.id === id ? { ...s, ...changes } : s));
  saveServers(updated);
  return updated;
}

function isLabelValid(label: string): boolean {
  return label.length > 0 && LABEL_PATTERN.test(label);
}

function isLabelUnique(servers: ServerEntry[], label: string, excludeId?: string): boolean {
  return !servers.some(
    (s) => s.label.toLowerCase() === label.toLowerCase() && s.id !== excludeId,
  );
}

function findServerByLabel(servers: ServerEntry[], label: string): ServerEntry | undefined {
  return servers.find((s) => s.label.toLowerCase() === label.toLowerCase());
}

// ---------------------------------------------------------------------------
// Hash 路由
// ---------------------------------------------------------------------------

interface HashRoute {
  workspace: string;
  serverLabel: string | null;
}

function parseHash(): HashRoute | null {
  const raw = location.hash.replace(/^#\/?/, "");
  if (!raw) return null;

  const atIdx = raw.lastIndexOf("@");
  if (atIdx > 0) {
    return {
      workspace: raw.slice(0, atIdx),
      serverLabel: raw.slice(atIdx + 1),
    };
  }
  return { workspace: raw, serverLabel: null };
}

function buildHash(workspace: string, serverLabel: string): string {
  return `${workspace}@${serverLabel}`;
}

// ---------------------------------------------------------------------------
// RPC 通信
// ---------------------------------------------------------------------------

interface RpcConnection {
  call<T>(method: string, params?: Record<string, unknown>): Promise<T>;
  close(): void;
}

let rpcNextId = 1;

interface ConnectResult {
  rpc: RpcConnection;
  version: string | null;
}

function connectServer(server: ServerEntry): Promise<ConnectResult | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const url = new URL(server.url);
    const protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${url.host}/ws/app`;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        resolve(null);
      }
    }, CONNECT_TIMEOUT);

    const ws = new WebSocket(wsUrl);
    const pending = new Map<
      string,
      { resolve: (v: unknown) => void; reject: (e: Error) => void }
    >();
    let serverVersion: string | null = null;
    let rpc: RpcConnection | null = null;

    function tryResolve() {
      if (resolved || !rpc || serverVersion === null) return;
      clearTimeout(timer);
      resolved = true;
      resolve({ rpc, version: serverVersion });
    }

    ws.onopen = () => {
      rpc = {
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
      tryResolve();
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string);
        if (msg.type === "event" && msg.event === "welcome") {
          const data = msg.data as { version?: string };
          serverVersion = data.version || "";
          tryResolve();
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
// DOM 辅助
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

// ---------------------------------------------------------------------------
// 动态加载 React 前端
// ---------------------------------------------------------------------------

function redirectToServer(server: ServerEntry, workspaceName?: string) {
  const url = workspaceName
    ? `${server.url}/#${workspaceName}`
    : server.url;
  window.location.replace(url);
}

function openWorkspace(name: string, server: ServerEntry, version: string | null) {
  // replaceState: 不创建历史条目，由 React SPA 统一管理 history
  history.replaceState(null, "", "#" + buildHash(name, server.label));
  if (version && findVersion(version)) {
    loadReactForVersion(version, server);
  } else {
    redirectToServer(server, name);
  }
}

function loadReactForVersion(version: string, server: ServerEntry) {
  const ver = findVersion(version);
  if (!ver) {
    redirectToServer(server, location.hash.replace(/^#\/?/, "").split("@")[0]);
    return;
  }

  const base = `/v${ver.version}/`;
  const url = new URL(server.url);
  const wsProtocol = url.protocol === "https:" ? "wss:" : "ws:";

  (window as any).__MUTBOT_CONTEXT__ = {
    remote: true,
    wsBase: `${wsProtocol}//${url.host}`,
    workspace: location.hash.replace(/^#\/?/, "").split("@")[0],
  };

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `${base}${ver.entry.css}`;
  document.head.appendChild(link);

  document.documentElement.classList.add("app-mode");

  const script = document.createElement("script");
  script.type = "module";
  script.src = `${base}${ver.entry.js}`;
  document.head.appendChild(script);
}

// ---------------------------------------------------------------------------
// 右键菜单
// ---------------------------------------------------------------------------

let activeContextMenu: HTMLElement | null = null;

function closeContextMenu() {
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
  }
}

function showContextMenu(
  e: MouseEvent,
  items: { label: string; danger?: boolean; handler: () => void }[],
) {
  e.preventDefault();
  closeContextMenu();

  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu.style.top = `${e.clientY}px`;
  menu.style.left = `${e.clientX}px`;

  menu.innerHTML = items
    .map(
      (item, i) => `
    <button class="ctx-menu-item${item.danger ? " ctx-menu-danger" : ""}" data-idx="${i}">
      <span>${item.label}</span>
    </button>`,
    )
    .join("");

  document.body.appendChild(menu);
  activeContextMenu = menu;

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 4}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 4}px`;

  menu.querySelectorAll(".ctx-menu-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt((btn as HTMLElement).dataset.idx || "0");
      closeContextMenu();
      items[idx].handler();
    });
  });

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
  requestAnimationFrame(() => {
    document.addEventListener("pointerdown", closeHandler);
    document.addEventListener("keydown", escHandler);
  });
}

// ---------------------------------------------------------------------------
// 服务器管理对话框
// ---------------------------------------------------------------------------

function openServerDialog(
  servers: ServerEntry[],
  onSave: (servers: ServerEntry[]) => void,
  existing?: ServerEntry,
) {
  const isEdit = !!existing;
  const overlay = document.createElement("div");
  overlay.className = "srv-dlg-overlay";
  overlay.innerHTML = `
    <div class="srv-dlg-dialog">
      <h3 class="srv-dlg-title">${isEdit ? "Edit Server" : "Add Server"}</h3>
      <div class="srv-dlg-row">
        <label class="srv-label">Name</label>
        <input id="srv-name" class="srv-dlg-input" type="text"
          placeholder="e.g. office" value="${existing?.label || ""}" />
      </div>
      <div class="srv-dlg-row" style="margin-top:8px">
        <label class="srv-label">Address</label>
        <input id="srv-url" class="srv-dlg-input" type="text"
          placeholder="host:port (default port 8741)" value="${existing ? new URL(existing.url).host : ""}" />
      </div>
      <div id="srv-error" class="srv-dlg-error hidden"></div>
      <div id="srv-test" class="srv-test-result hidden"></div>
      <div class="srv-dlg-actions">
        <button id="srv-cancel" class="srv-dlg-btn-secondary">Cancel</button>
        <button id="srv-test-btn" class="srv-dlg-btn-secondary">Test</button>
        <button id="srv-save" class="srv-dlg-btn-primary">Save</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const nameInput = overlay.querySelector("#srv-name") as HTMLInputElement;
  const urlInput = overlay.querySelector("#srv-url") as HTMLInputElement;
  const errorDiv = overlay.querySelector("#srv-error") as HTMLDivElement;
  const testDiv = overlay.querySelector("#srv-test") as HTMLDivElement;

  function showError(msg: string) {
    errorDiv.textContent = msg;
    errorDiv.classList.remove("hidden");
  }

  function hideError() {
    errorDiv.classList.add("hidden");
  }

  function parseAddress(): string | null {
    let addr = urlInput.value.trim();
    if (!addr) { showError("Address is required"); return null; }

    // 如果没有协议前缀，默认加 http://
    if (!/^https?:\/\//i.test(addr)) {
      addr = `http://${addr}`;
    }
    try {
      const u = new URL(addr);
      // 没有端口则默认 8741
      if (!u.port) {
        u.port = "8741";
      }
      return u.origin;
    } catch {
      showError("Invalid address");
      return null;
    }
  }

  // Test
  overlay.querySelector("#srv-test-btn")!.addEventListener("click", async () => {
    hideError();
    const urlStr = parseAddress();
    if (!urlStr) return;

    testDiv.textContent = "Connecting...";
    testDiv.classList.remove("hidden");

    const tempServer: ServerEntry = { id: "", label: "", url: urlStr };
    const result = await connectServer(tempServer);
    if (result) {
      testDiv.textContent = `Connected — version ${result.version || "unknown"}`;
      result.rpc.close();
    } else {
      testDiv.textContent = "Could not connect (you can still save)";
    }
  });

  // Save
  overlay.querySelector("#srv-save")!.addEventListener("click", () => {
    hideError();

    const label = nameInput.value.trim();
    const urlStr = parseAddress();
    if (!urlStr) return;

    // label 校验
    if (!label) {
      // 从地址自动生成
      try {
        const u = new URL(urlStr);
        const autoLabel = u.hostname.replace(/\./g, "-");
        nameInput.value = autoLabel;
      } catch { /* ignore */ }
      if (!nameInput.value.trim()) {
        showError("Name is required");
        return;
      }
    }

    const finalLabel = nameInput.value.trim();
    if (!isLabelValid(finalLabel)) {
      showError("Name can only contain letters, numbers, and hyphens");
      return;
    }
    if (!isLabelUnique(servers, finalLabel, existing?.id)) {
      showError("A server with this name already exists");
      return;
    }

    if (isEdit && existing) {
      const updated = updateServer(servers, existing.id, { label: finalLabel, url: urlStr });
      onSave(updated);
    } else {
      const entry: ServerEntry = {
        id: crypto.randomUUID(),
        label: finalLabel,
        url: urlStr,
      };
      const updated = addServer(servers, entry);
      onSave(updated);
    }

    overlay.remove();
  });

  // Cancel
  overlay.querySelector("#srv-cancel")!.addEventListener("click", () => {
    overlay.remove();
  });
}

// ---------------------------------------------------------------------------
// Landing 页面：服务器列表 + 工作区
// ---------------------------------------------------------------------------

type ServerStatus = "connecting" | "online" | "offline";

interface ServerState {
  server: ServerEntry;
  status: ServerStatus;
  version: string | null;
  rpc: RpcConnection | null;
  workspaces: Workspace[];
}

function renderLanding(servers: ServerEntry[]) {
  const wsArea = document.getElementById("ws-area")!;
  const newBtn = document.getElementById("new-ws-btn")!;

  // 改标题
  const heading = document.querySelector(".section-heading") as HTMLElement;
  if (heading && heading.textContent?.includes("Open Workspace")) {
    heading.textContent = "2. Servers";
  }

  // 将 "+ New" 按钮改为 "+ Add"（添加服务器）
  newBtn.textContent = "+ Add";
  newBtn.classList.remove("hidden");
  const addBtnClone = newBtn.cloneNode(true) as HTMLElement;
  newBtn.replaceWith(addBtnClone);

  let currentServers = [...servers];
  const states = new Map<string, ServerState>();

  // 初始化每个服务器的状态
  for (const srv of currentServers) {
    states.set(srv.id, {
      server: srv,
      status: "connecting",
      version: null,
      rpc: null,
      workspaces: [],
    });
  }

  function render() {
    if (currentServers.length === 0) {
      wsArea.innerHTML = `<p class="ws-status empty">No servers — click "+ Add" to add one</p>`;
      return;
    }

    wsArea.innerHTML = currentServers
      .map((srv) => {
        const state = states.get(srv.id)!;
        return renderServerCard(state);
      })
      .join("");

    // 绑定事件
    for (const srv of currentServers) {
      const state = states.get(srv.id)!;
      const card = wsArea.querySelector(`[data-server-id="${srv.id}"]`) as HTMLElement;
      if (!card) continue;

      bindServerCardEvents(card, state);
    }
  }

  function renderServerCard(state: ServerState): string {
    const { server, status, version, workspaces } = state;
    const statusClass =
      status === "online" ? "srv-online" :
      status === "connecting" ? "srv-connecting" :
      "srv-offline";

    const versionText = version ? ` v${version}` : "";

    let body = "";

    if (status === "online") {
      if (workspaces.length === 0) {
        body = `<p class="ws-status empty">No workspaces yet — <a href="#" class="ws-create-link" data-server="${server.id}">create one</a></p>`;
      } else {
        const visible = workspaces.slice(0, MAX_VISIBLE);
        const hasMore = workspaces.length > MAX_VISIBLE;
        body = `<div class="ws-list">${visible
          .map(
            (ws) => `
          <button class="ws-item" data-name="${ws.name}" data-id="${ws.id}" data-server="${server.id}">
            <svg class="ws-item-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <span class="ws-item-name">${ws.name}</span>
            <span class="ws-item-path">${shortenPath(ws.project_path)}</span>
            <span class="ws-item-remove" data-id="${ws.id}" data-server="${server.id}" title="Remove">−</span>
          </button>`,
          )
          .join("")}${hasMore ? `<button class="ws-more" data-server="${server.id}">More...</button>` : ""}</div>`;
      }
    } else if (status === "offline") {
      body = `
        <div class="srv-offline-msg">
          <span>Cannot connect.</span>
          <a href="${server.url}" class="srv-try-open" target="_blank" rel="noopener">Open directly</a>
        </div>`;
    }
    // connecting: body 为空，图标闪烁已暗示连接中

    const monitorIcon = `<svg class="srv-icon ${statusClass}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;

    const headerHtml = `
      <div class="srv-header" data-server-id="${server.id}">
        ${monitorIcon}
        <span class="srv-label">${server.label}</span>
        <span class="srv-url">(${new URL(server.url).host})</span>${versionText ? `<span class="srv-version">${versionText}</span>` : ""}
        ${status === "online" ? `<button class="srv-new-ws-btn" data-server="${server.id}" title="New Workspace">+<span class="srv-new-ws-label">New</span></button>` : ""}
      </div>`;

    return `
      <div class="srv-section" data-server-id="${server.id}">
        ${headerHtml}
        <div class="srv-body">${body}</div>
      </div>`;
  }

  function bindServerCardEvents(card: HTMLElement, state: ServerState) {
    const { server, rpc, version } = state;

    // 服务器 header 右键菜单
    const header = card.querySelector(".srv-header") as HTMLElement | null;
    if (header) {
      header.addEventListener("contextmenu", (e) => {
        showContextMenu(e as MouseEvent, [
          { label: "Edit", handler: () => editServer(server) },
          { label: "Reconnect", handler: () => reconnectServer(server.id) },
          { label: "Remove", danger: true, handler: () => doRemoveServer(server) },
        ]);
      });
    }

    // 工作区点击
    card.querySelectorAll(".ws-item").forEach((btn) => {
      const el = btn as HTMLElement;
      el.addEventListener("click", () => {
        const name = el.dataset.name;
        if (name) {
          closeAllConnections();
          openWorkspace(name, server, version);
        }
      });
      el.addEventListener("contextmenu", (ev) => {
        if (!rpc) return;
        const wsId = el.dataset.id!;
        const ws = state.workspaces.find((w) => w.id === wsId);
        if (!ws) return;
        showContextMenu(ev as MouseEvent, [
          {
            label: "Remove",
            danger: true,
            handler: async () => {
              if (!confirm(`Remove workspace "${ws.name}" from list?`)) return;
              try {
                await rpc.call("workspace.remove", { workspace_id: ws.id });
                state.workspaces = state.workspaces.filter((w) => w.id !== wsId);
                render();
              } catch { /* ignore */ }
            },
          },
        ]);
      });
    });

    // 工作区删除按钮
    card.querySelectorAll(".ws-item-remove").forEach((btn) => {
      const el = btn as HTMLElement;
      el.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!rpc) return;
        const wsId = el.dataset.id!;
        const ws = state.workspaces.find((w) => w.id === wsId);
        if (!ws) return;
        if (!confirm(`Remove workspace "${ws.name}" from list?`)) return;
        try {
          await rpc.call("workspace.remove", { workspace_id: ws.id });
          state.workspaces = state.workspaces.filter((w) => w.id !== wsId);
          render();
        } catch { /* ignore */ }
      });
    });

    // More...
    const moreBtn = card.querySelector(".ws-more") as HTMLElement | null;
    if (moreBtn && rpc) {
      moreBtn.addEventListener("click", () => {
        openWorkspaceSearch(state.workspaces, rpc, server, version, (removedId) => {
          state.workspaces = state.workspaces.filter((w) => w.id !== removedId);
          render();
        });
      });
    }

    // + New Workspace (hover button in header)
    const newWsBtn = card.querySelector(".srv-new-ws-btn") as HTMLElement | null;
    if (newWsBtn) {
      newWsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        navigateNewWorkspace(state, version);
      });
    }

    // "create one" link in empty state
    const createLink = card.querySelector(".ws-create-link") as HTMLElement | null;
    if (createLink) {
      createLink.addEventListener("click", (e) => {
        e.preventDefault();
        navigateNewWorkspace(state, version);
      });
    }
  }

  /** 生成不存在的 workspace 名称，设入 hash 触发 React 加载 */
  function navigateNewWorkspace(state: ServerState, version: string | null) {
    const { server, workspaces } = state;
    const taken = new Set(workspaces.map((w) => w.name));
    let name = "new-project";
    let i = 1;
    while (taken.has(name)) name = `new-project${i++}`;
    closeAllConnections();
    openWorkspace(name, server, version);
  }

  function closeAllConnections() {
    for (const state of states.values()) {
      if (state.rpc) {
        state.rpc.close();
        state.rpc = null;
      }
    }
  }

  function editServer(server: ServerEntry) {
    openServerDialog(currentServers, (updated) => {
      currentServers = updated;
      // 更新 state 中的 server 引用
      const state = states.get(server.id);
      if (state) {
        const newEntry = updated.find((s) => s.id === server.id);
        if (newEntry) {
          const urlChanged = newEntry.url !== state.server.url;
          state.server = newEntry;
          if (urlChanged) reconnectServer(server.id);
        }
      }
      render();
    }, server);
  }

  function doRemoveServer(server: ServerEntry) {
    if (!confirm(`Remove server "${server.label}"?`)) return;
    const state = states.get(server.id);
    if (state?.rpc) state.rpc.close();
    states.delete(server.id);
    currentServers = removeServer(currentServers, server.id);
    render();
  }

  async function reconnectServer(serverId: string) {
    const state = states.get(serverId);
    if (!state) return;

    if (state.rpc) { state.rpc.close(); state.rpc = null; }
    state.status = "connecting";
    state.version = null;
    state.workspaces = [];
    render();

    const result = await connectServer(state.server);
    if (result) {
      state.status = "online";
      state.version = result.version;
      state.rpc = result.rpc;
      state.server.lastVersion = result.version || undefined;
      state.server.lastConnectedAt = new Date().toISOString();
      currentServers = updateServer(currentServers, serverId, {
        lastVersion: state.server.lastVersion,
        lastConnectedAt: state.server.lastConnectedAt,
      });
      try {
        state.workspaces = await result.rpc.call<Workspace[]>("workspace.list");
      } catch {
        state.workspaces = [];
      }
    } else {
      state.status = "offline";
    }
    render();
  }

  // + Add 按钮
  addBtnClone.addEventListener("click", () => {
    openServerDialog(currentServers, (updated) => {
      const newEntry = updated.find(
        (s) => !currentServers.some((cs) => cs.id === s.id),
      );
      currentServers = updated;
      if (newEntry) {
        states.set(newEntry.id, {
          server: newEntry,
          status: "connecting",
          version: null,
          rpc: null,
          workspaces: [],
        });
        render();
        reconnectServer(newEntry.id);
      }
    });
  });

  // 初始渲染 + 并行探测
  render();

  for (const srv of currentServers) {
    reconnectServer(srv.id);
  }
}

// ---------------------------------------------------------------------------
// 工作区搜索对话框
// ---------------------------------------------------------------------------

function openWorkspaceSearch(
  workspaces: Workspace[],
  rpc: RpcConnection,
  server: ServerEntry,
  version: string | null,
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
        ws.project_path.toLowerCase().includes(q),
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
      </button>`,
      )
      .join("");

    listDiv.querySelectorAll(".ws-search-item").forEach((btn) => {
      const el = btn as HTMLElement;
      el.addEventListener("click", () => {
        const name = el.dataset.name;
        if (name) {
          overlay.remove();
          openWorkspace(name, server, version);
        }
      });
      el.addEventListener("contextmenu", (ev) => {
        const wsId = el.dataset.id!;
        const ws = wsList.find((w) => w.id === wsId);
        if (!ws) return;
        showContextMenu(ev as MouseEvent, [
          {
            label: "Remove",
            danger: true,
            handler: async () => {
              if (!confirm(`Remove workspace "${ws.name}" from list?`)) return;
              try {
                await rpc.call("workspace.remove", { workspace_id: ws.id });
                wsList = wsList.filter((w) => w.id !== wsId);
                onRemoved(wsId);
                render(input.value);
              } catch { /* ignore */ }
            },
          },
        ]);
      });
    });
  }

  render("");
  input.addEventListener("input", () => render(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") overlay.remove();
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

// ---------------------------------------------------------------------------
// 平台检测 + Install 区域切换
// ---------------------------------------------------------------------------

function initPlatformTabs() {
  const tabs = document.querySelectorAll<HTMLButtonElement>(".install-tab");
  const panels = document.querySelectorAll<HTMLElement>(".install-panel");
  if (tabs.length === 0) return;

  // 移动端：隐藏 tabs 和安装命令，显示引导文案
  if (isMobile()) {
    const tabsContainer = document.querySelector(".install-tabs") as HTMLElement | null;
    if (tabsContainer) tabsContainer.style.display = "none";
    const box = document.querySelector(".install-box") as HTMLElement | null;
    if (box) {
      box.innerHTML = `<p style="color:#858585;font-size:13px;margin:0">Install mutbot on your computer, connect from your phone.</p>`;
    }
    return;
  }

  const isWindows =
    /Win/i.test(navigator.platform) ||
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

  // Back/forward 时 reload，确保 launcher 重新初始化
  // （后退：清除动态注入的 SPA 状态；前进：重新加载 workspace）
  window.addEventListener("popstate", () => {
    location.reload();
  });

  // 加载版本信息
  versionsData = await fetch("/versions.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null) as VersionsJson | null;

  const servers = loadServers();
  const hashRoute = parseHash();

  if (hashRoute) {
    // Hash 有值 — 直接连接目标服务器，加载 React SPA
    await handleHashRoute(hashRoute, servers);
  } else {
    // 无 hash — Landing 页面，显示服务器列表
    renderLanding(servers);
  }
}

async function handleHashRoute(route: HashRoute, servers: ServerEntry[]) {
  let targetServer: ServerEntry | undefined;

  if (route.serverLabel) {
    targetServer = findServerByLabel(servers, route.serverLabel);
    if (!targetServer) {
      // 未找到服务器，回退到 Landing
      location.hash = "";
      document.documentElement.classList.remove("app-mode");
      renderLanding(servers);
      return;
    }
  } else {
    // 无 @server，向后兼容：逐个尝试连接，找第一个有该工作区的服务器
    for (const srv of servers) {
      const result = await connectServer(srv);
      if (result) {
        try {
          const workspaces = await result.rpc.call<Workspace[]>("workspace.list");
          const match = workspaces.find((ws) => ws.name === route.workspace);
          if (match) {
            targetServer = srv;
            history.replaceState(null, "", "#" + buildHash(route.workspace, srv.label));
            if (result.version && findVersion(result.version)) {
              loadReactForVersion(result.version, srv);
            } else {
              redirectToServer(srv, route.workspace);
            }
            return;
          }
        } catch { /* ignore */ }
        result.rpc.close();
      }
    }
    // 没找到匹配的工作区，回退到 Landing
    location.hash = "";
    document.documentElement.classList.remove("app-mode");
    renderLanding(servers);
    return;
  }

  // 有明确的 server label，连接该服务器
  const result = await connectServer(targetServer);
  if (result) {
    if (result.version && findVersion(result.version)) {
      loadReactForVersion(result.version, targetServer);
    } else {
      redirectToServer(targetServer, route.workspace);
    }
  } else {
    // 连接失败，尝试 Level 3 重定向
    redirectToServer(targetServer, route.workspace);
  }
}

// DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
