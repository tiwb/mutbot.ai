# 安装启动脚本重设计 — 设计规范

**状态**：✅ 已完成
**日期**：2026-02-27
**类型**：功能设计

## 1. 背景

当前 `install.sh` / `install.ps1` 只做安装（通过 pip），不启动 mutbot，且依赖用户系统已有的 Python 环境。存在以下问题：

- **只安装不启动**：脚本结束后只打印"请运行 python -m mutbot"，用户需手动操作
- **污染系统环境**：直接 `pip install` 到系统 Python，可能与用户其他包冲突
- **不可重复运行**：没有"已安装则跳过/更新"逻辑，重复运行体验差
- **依赖系统 Python**：要求用户预装 Python 3.11+，门槛高

### 目标

重新设计安装脚本，使其：

1. **一键安装并启动**：用户粘贴命令后，mutbot 直接在终端里运行起来
2. **独立环境**：mutbot 运行在隔离的 Python 环境中，不影响用户系统
3. **可重复运行**：已安装时直接启动，未安装时先安装再启动（不自动升级，升级由 mutbot 自身处理）
4. **零前置依赖**：脚本自行安装所需工具（uv），无需用户预装 Python

### 涉及文件

| 文件 | 说明 |
|------|------|
| `public/install.sh` | macOS / Linux 安装启动脚本 |
| `public/install.ps1` | Windows 安装启动脚本 |
| `src/components/Landing.astro` | 网页上的命令展示（可能需调整标签文案） |

## 2. 设计方案

### 2.1 工具选型：uv

使用 [uv](https://docs.astral.sh/uv/) 作为唯一的安装和环境管理工具：

- **自带 Python 管理**：`uv` 可自动下载所需版本的 Python，用户无需预装
- **`uv tool install`**：为 CLI 工具创建隔离虚拟环境，安装到 `~/.local/share/uv/tools/mutbot/`，并在 `~/.local/bin/` 创建可执行入口
- **快速**：比 pip 快 10-100 倍
- **跨平台**：macOS / Linux / Windows 均支持

### 2.2 安装位置与隔离

`uv tool install mutbot` 的安装布局：

```
~/.local/share/uv/tools/mutbot/    # 隔离的虚拟环境（含 Python + 所有依赖）
~/.local/bin/mutbot                  # 可执行入口（自动生成的 wrapper）
```

- 完全独立于系统 Python
- 不影响用户的 `pip list` / `conda` / 其他虚拟环境
- `uv tool install --upgrade mutbot` 原地更新，保持隔离

### 2.3 脚本流程

```
用户运行脚本
  ├─ uv 已安装？
  │   ├─ 是 → 跳过
  │   └─ 否 → 安装 uv
  ├─ mutbot 已安装（uv tool）？
  │   ├─ 是 → 跳过（不自动升级，由 mutbot 自身处理更新）
  │   └─ 否 → uv tool install mutbot
  └─ 启动 mutbot（前台运行，Ctrl+C 退出）
```

### 2.4 install.sh（macOS / Linux）

```bash
#!/bin/sh
# MutBot — install & launch
# Usage: curl -LsSf https://mutbot.ai/install.sh | sh
set -eu

# --- Install uv if not present ---
if ! command -v uv >/dev/null 2>&1; then
    echo "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    # uv installer adds ~/.local/bin to PATH via shell profile,
    # but current shell session needs explicit export
    export PATH="$HOME/.local/bin:$PATH"
fi

# --- Install mutbot if not present ---
if ! uv tool list 2>/dev/null | grep -q "^mutbot "; then
    echo "Installing mutbot..."
    uv tool install mutbot
fi

# --- Ensure ~/.local/bin is on PATH ---
export PATH="$HOME/.local/bin:$PATH"

# --- Launch ---
echo ""
echo "Starting MutBot..."
echo ""
exec mutbot
```

### 2.5 install.ps1（Windows）

```powershell
# MutBot — install & launch
# Usage: irm https://mutbot.ai/install.ps1 | iex
$ErrorActionPreference = "Stop"

# --- Install uv if not present ---
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "Installing uv..." -ForegroundColor Cyan
    irm https://astral.sh/uv/install.ps1 | iex
    # Refresh PATH for current session
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "Machine")
}

# --- Install mutbot if not present ---
$toolList = uv tool list 2>$null
if ($toolList -notmatch "^mutbot ") {
    Write-Host "Installing mutbot..." -ForegroundColor Cyan
    uv tool install mutbot
}

# --- Launch ---
Write-Host ""
Write-Host "Starting MutBot..."
Write-Host ""
& mutbot
```

### 2.6 网页命令标签

当前网页 "Run MutBot" 区域有 4 个标签。维持现有标签不变，脚本内容已自动更新（因为是远程获取的脚本）：

| 标签 | 命令 | 说明 |
|------|------|------|
| macOS / Linux | `curl -LsSf https://mutbot.ai/install.sh \| sh` | 一键安装并启动 |
| Windows | `irm https://mutbot.ai/install.ps1 \| iex` | 一键安装并启动 |
| uv | `uvx mutbot` | 已有 uv 的用户，临时运行 |
| pip | `pip install mutbot && python -m mutbot` | 传统方式 |

## 3. 待定问题

（无待定问题）

## 4. 实施步骤清单

### 阶段一：mutbot 包入口点 [✅ 已完成]
- [x] **Task 1.1**: mutbot pyproject.toml 添加 `[project.scripts]`
  - [x] 添加 `mutbot = "mutbot.__main__:main"` 入口点
  - [x] 本地验证 `uv tool install -e .` 后 `mutbot` 命令可用
  - 状态：✅ 已完成

### 阶段二：安装脚本重写 [✅ 已完成]
- [x] **Task 2.1**: 重写 `public/install.sh`
  - [x] uv 检测 + 安装
  - [x] mutbot 检测 + 安装（不升级）
  - [x] 前台启动 mutbot
  - 状态：✅ 已完成

- [x] **Task 2.2**: 重写 `public/install.ps1`
  - [x] uv 检测 + 安装
  - [x] mutbot 检测 + 安装（不升级）
  - [x] 前台启动 mutbot
  - 状态：✅ 已完成

### 阶段三：网页更新（如需）[✅ 已完成]
- [x] **Task 3.1**: 检查并更新 Landing.astro 命令标签
  - [x] 确认无需调整（Shell 标签引用远程脚本，内容自动更新）
  - 状态：✅ 已完成

### 阶段四：关联文档更新 [✅ 已完成]
- [x] **Task 4.1**: 更新 `feature-website-launch.md` 安装脚本部分
  - [x] §7 安装脚本内容替换为引用本文档
  - [x] §8 阶段三、阶段四任务清单标记为已完成
  - 状态：✅ 已完成

- [x] **Task 4.2**: 更新 `feature-workspace-selector.md` 安装脚本引用
  - [x] §4 阶段四任务清单指向本文档
  - 状态：✅ 已完成

## 5. 测试验证

### 手动测试
- [ ] macOS：首次运行 install.sh（无 uv、无 mutbot）→ 安装 uv → 安装 mutbot → 启动
- [ ] macOS：再次运行 install.sh → 跳过安装 → 直接启动
- [ ] Linux：同上两项
- [x] Windows：首次运行 install.ps1 → 完整流程
- [x] Windows：再次运行 install.ps1 → 跳过安装 → 直接启动
- [x] `uvx mutbot`：验证可正常运行
- [x] `uv tool install mutbot` 后 `mutbot` 命令可用
