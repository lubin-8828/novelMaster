#!/usr/bin/env bash
#
# novelMaster 卸载（Linux / macOS / Termux）—— 薄转发。
# 逻辑与提示在 scripts/uninstall.mjs（Node 实现，跨平台）。
# 见 docs/design/architecture.md「开发与调试」。

set -eu
cd "$(dirname "$0")"
exec node scripts/uninstall.mjs
