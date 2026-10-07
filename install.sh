#!/bin/bash
# VGET 一键安装：检查依赖 → 构建 VGET.app → 放进「应用程序」→ 固定到 Dock → 打开
#
# 用法（二选一，只需执行一次）：
#   bash install.sh                  # 已 clone 仓库时，在仓库目录执行
#   curl -fsSL https://raw.githubusercontent.com/YorenZZZ/vget/main/install.sh | bash
#
# 选项：
#   --no-dock   不固定到 Dock
#   --no-open   安装完成后不自动打开
#   （通过 curl 执行时这样传参：curl ... | bash -s -- --no-dock）

set -euo pipefail

REPO_TARBALL="https://github.com/YorenZZZ/vget/archive/refs/heads/main.tar.gz"
APP_NAME="VGET"
SRC_DIR="${VGET_SRC:-$HOME/.vget}"   # 通过 curl 安装时，源码存放位置
# 可选环境变量：VGET_INSTALL_DIR 指定安装目录（默认 /Applications）

ADD_DOCK=1
OPEN_APP=1
for arg in "$@"; do
  case "$arg" in
    --no-dock) ADD_DOCK=0 ;;
    --no-open) OPEN_APP=0 ;;
    *) echo "未知参数：${arg}（可用：--no-dock --no-open）"; exit 1 ;;
  esac
done

info() { printf '\033[1;35m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[提示]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[错误]\033[0m %s\n' "$*"; exit 1; }

[ "$(uname)" = "Darwin" ] || fail "VGET 桌面应用目前仅支持 macOS"

# ---------- 1. 依赖 ----------
info "1/5 检查依赖"
HAS_BREW=0
command -v brew >/dev/null 2>&1 && HAS_BREW=1

if ! command -v npm >/dev/null 2>&1; then
  if [ "$HAS_BREW" = 1 ]; then
    info "安装 Node.js"
    brew install node
  else
    fail "未找到 Node.js。请先安装 Homebrew（https://brew.sh）或 Node.js（https://nodejs.org），再重新运行本脚本"
  fi
fi

# yt-dlp / ffmpeg 用于 B站/YouTube/TikTok；缺失不影响抖音下载
for tool in yt-dlp ffmpeg; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    if [ "$HAS_BREW" = 1 ]; then
      info "安装 $tool"
      brew install "$tool"
    else
      warn "未找到 ${tool}，B站/YouTube/TikTok 下载将不可用（安装 Homebrew 后执行 brew install ${tool}）"
    fi
  fi
done

# ---------- 2. 源码 ----------
info "2/5 准备源码"
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/main.js" ]; then
  SRC="$SCRIPT_DIR"
else
  # 通过 curl 执行：下载最新源码到 ${SRC_DIR}（保留已下载的 node_modules，加快重装）
  SRC="$SRC_DIR"
  TMP="$(mktemp -d)"
  curl -fsSL "$REPO_TARBALL" | tar -xz -C "$TMP"
  mkdir -p "$SRC"
  cp -R "$TMP"/vget-main/. "$SRC"/
  rm -rf "$TMP"
fi
echo "    源码目录：$SRC"
cd "$SRC"

# ---------- 3. 安装 npm 依赖（含 Electron） ----------
info "3/5 安装 Electron 等依赖（首次需要下载约 100MB）"
npm install --no-audit --no-fund
# 新版 npm 可能默认跳过依赖的安装脚本，导致 Electron 本体未下载，这里兜底补装
if [ ! -d node_modules/electron/dist/Electron.app ]; then
  info "下载 Electron 本体"
  node node_modules/electron/install.js
fi

# ---------- 4. 构建并安装 ----------
INSTALL_DIR="${VGET_INSTALL_DIR:-/Applications}"
if [ ! -w "$INSTALL_DIR" ] && [ -z "${VGET_INSTALL_DIR:-}" ]; then
  INSTALL_DIR="$HOME/Applications"
  warn "没有 /Applications 写权限，改为安装到 $INSTALL_DIR"
fi
info "4/5 构建并安装到 $INSTALL_DIR"
INSTALL_DIR="$INSTALL_DIR" bash "$SRC/build.sh"
APP_PATH="$INSTALL_DIR/$APP_NAME.app"

# ---------- 5. Dock ----------
if [ "$ADD_DOCK" = 1 ]; then
  if defaults read com.apple.dock persistent-apps 2>/dev/null | grep -q "$APP_PATH/"; then
    info "5/5 Dock 中已有 ${APP_NAME}，跳过"
  else
    info "5/5 固定到 Dock"
    defaults write com.apple.dock persistent-apps -array-add \
      "<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>file://$APP_PATH/</string><key>_CFURLStringType</key><integer>15</integer></dict></dict></dict>"
    killall Dock
  fi
else
  info "5/5 已按参数跳过 Dock"
fi

[ "$OPEN_APP" = 1 ] && open "$APP_PATH"

echo
echo "🎉 安装完成！以后可以从 Dock、启动台或「应用程序」文件夹打开 ${APP_NAME}。"
echo "   更新：重新运行一次本脚本即可。"
