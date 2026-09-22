#!/usr/bin/env bash
#
# 启动 novelMaster。
#
# 它是 **TUI 程序，不是服务** —— 必须在能交互的终端里前台跑（用户要看着界面输入）。
# 所以这个脚本不做「后台 daemon」，它做的是：把该检查的检查好，然后把终端交给你。
#
# 想让它常驻（手机息屏后还在），用 tmux —— 见脚本末尾的提示。

set -eu
cd "$(dirname "$0")"

PID_FILE=".novelmaster/novelmaster.pid"

# ---------- 1. 前置检查（宁可在启动前失败，也不要在半路崩） ----------

if ! command -v node >/dev/null 2>&1; then
  echo "找不到 node。装它：pkg install nodejs" >&2
  exit 1
fi

# 本项目依赖 Node 的原生 TypeScript 类型剥离，需要 >= 22.19。
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)'; then
  echo "Node 版本太低：当前 $(node -p 'process.versions.node')，需要 >= 22.19.0" >&2
  echo "（本项目的「无构建步骤」依赖原生 TS 类型剥离）" >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "还没有装依赖。先跑：npm install" >&2
  exit 1
fi

# TUI 需要交互终端。这个检查是**有意的**：后台启动它的结果是「进程活着，
# 但你既看不到界面也没法输入」—— 与其让人对着一个不响应的进程发呆，不如现在说清。
if [ ! -t 0 ] || [ ! -t 1 ]; then
  echo "novelMaster 需要交互终端（它是个 TUI，不是后台服务）。" >&2
  echo "" >&2
  echo "想让它常驻（比如手机息屏后还在）：" >&2
  echo "  pkg install tmux" >&2
  echo "  tmux new -s novelmaster './start.sh'    # 起来后 Ctrl+B 然后 D 脱离" >&2
  echo "  tmux attach -t novelmaster              # 下次接回去" >&2
  exit 1
fi

# 已经在跑就不重复启动（pidfile 指向的进程还活着）。
if [ -f "$PID_FILE" ]; then
  existing="$(cat "$PID_FILE" 2>/dev/null || echo "")"
  if [ -n "$existing" ] && kill -0 "$existing" 2>/dev/null; then
    echo "已经有一个 novelMaster 在跑（pid $existing）。" >&2
    echo "要停止它：./stop.sh" >&2
    exit 1
  fi
  rm -f "$PID_FILE"
fi

# ---------- 2. 启动 ----------

mkdir -p .novelmaster
# **用 `exec` 启动**：node 顶替 shell，而 exec **保留 pid** —— 所以 pidfile 里的 pid
# 就是 node 的 pid，stop.sh kill 它才是真的杀到了进程。
#
# 不用 `node ... &` + `wait`：后台进程不在前台进程组里，读终端会被 SIGTTIN 停掉，
# TUI 直接卡死。
#
# 代价：shell 的 EXIT trap 不会执行，pidfile 会残留。没关系 —— 它指向一个
# 不存在的进程时，start.sh 与 stop.sh 都会自动清理（自愈）。
echo $$ > "$PID_FILE"

echo "启动 novelMaster…"
echo "  退出：Ctrl+C，或在对话里敲 /quit"
echo "  在另一个终端停止：./stop.sh"
echo ""

exec node src/cli.ts
