#!/usr/bin/env bash
#
# novelMaster 安装（Linux / macOS / Termux）—— 薄转发。
# 逻辑与提示在 scripts/install.mjs（Node 实现，跨平台）。
# 见 docs/design/architecture.md「开发与调试」。

set -eu
cd "$(dirname "$0")"
exec node scripts/install.mjs
