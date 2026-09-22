#!/usr/bin/env bash
#
# 停止 novelMaster。
#
# **正常情况下你不需要它** —— novelMaster 是 TUI，直接在那个终端按 Ctrl+C，
# 或者在对话里敲 /quit 就行（那是优雅退出，正在跑的子会话能收尾）。
#
# 这个脚本给两种情况：
#   1. 它在另一个终端里跑着，你懒得去找那个终端；
#   2. 它卡住了（比如某个子会话卡在网络请求上），Ctrl+C 没反应。
#
# 安全性说明：本项目所有写入都是「临时文件 + rename + fsync」的原子写，
# 所以即使被强杀，也不会留下半截 JSON 或半截正文。被中断的最多是
# 「正在跑的那次工具调用」，用户会在界面上看到那次调用失败。

set -eu
cd "$(dirname "$0")"

PID_FILE=".novelmaster/novelmaster.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "没有找到运行中的 novelMaster（$PID_FILE 不存在）。"
  echo "如果它跑在某个终端里，直接在那个终端按 Ctrl+C 或敲 /quit。"
  exit 0
fi

pid="$(cat "$PID_FILE" 2>/dev/null || echo "")"
if [ -z "$pid" ]; then
  echo "pidfile 是空的，清掉它。" >&2
  rm -f "$PID_FILE"
  exit 1
fi

if ! kill -0 "$pid" 2>/dev/null; then
  echo "pidfile 里的进程（$pid）已经不在了，清掉这个文件。"
  rm -f "$PID_FILE"
  exit 0
fi

echo "正在停止 novelMaster（pid $pid）…"
kill "$pid" 2>/dev/null || true

# 给它 5 秒优雅退出：正在跑的子会话（审查 / 去 AI 味可能好几分钟）有机会收尾。
for _ in 1 2 3 4 5; do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "已停止。"
    rm -f "$PID_FILE"
    exit 0
  fi
  sleep 1
done

echo "5 秒内没有退出，强制结束。"
echo "（原子写保证不会留半截文件；被中断的只是那次正在跑的工具调用）"
kill -9 "$pid" 2>/dev/null || true
rm -f "$PID_FILE"
echo "已强制停止。"
