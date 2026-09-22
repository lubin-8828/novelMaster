import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { CMD, ENTRY_LAYERS, LAYERS, ALL_COMMANDS, COMMANDS, getLayer, setLayer, type CmdName, type Layer } from "./layers.ts";
import { renderContext, renderHelp, renderBrainstormTask, renderNextTask, renderStatus, CHAPTER_STATUS_LABEL } from "./render.ts";
import { renderLayerData, safeLayerData } from "./layer-data.ts";
import { assemble } from "../ai/context-assembler.ts";
import { runReviewAndPersist } from "../ai/review/index.ts";
import { runDeaiWithRecheck } from "../ai/deai/index.ts";
import { advanceStatus, startNextChapter } from "../data/state.ts";
import { chapterNo } from "../data/ids.ts";
import { chapterSummaryPath } from "../data/paths.ts";
import { exists } from "../data/io.ts";
import { errorText } from "../data/errors.ts";
import { openNovel } from "../data/novel.ts";
import { defaultNovelRoot, writeConfig } from "../data/paths.ts";
import { initNovel, slugify } from "../data/init.ts";

/**
 * 把 /help 之类的长文本作为消息放进对话记录。
 *
 * 用 sendMessage 而不是 notify：notify 是一闪而过的提示条，
 * 而"这一层有哪些命令"是需要能回看的参考信息。
 */
function emit(pi: ExtensionAPI, customType: string, text: string): void {
  pi.sendMessage({ customType, content: text, display: true });
}

function refreshStatus(ctx: ExtensionContext): void {
  const layer = getLayer();
  const novel = openNovel();
  const chapter =
    novel && layer === "write"
      ? { no: novel.state.currentChapter, status: novel.state.chapterStatus }
      : null;
  ctx.ui.setStatus(
    "novelmaster",
    renderStatus(layer, novel ? { title: novel.meta.title } : null, chapter),
  );
}

export function registerCommands(pi: ExtensionAPI): void {
  /* ---------- 通用命令 ---------- */

  pi.registerCommand(CMD.help, {
    description: "显示当前层面可用命令",
    handler: async (_args, ctx) => {
      const novel = openNovel();
      emit(
        pi,
        "novelmaster-help",
        renderHelp(getLayer(), novel ? { title: novel.meta.title, root: novel.root } : null),
      );
    },
  });

  pi.registerCommand(CMD.back, {
    description: "返回上一层",
    handler: async (_args, ctx) => {
      if (getLayer() === "menu") {
        ctx.ui.notify("已在主菜单。要退出程序请用 /quit。", "info");
        return;
      }
      setLayer("menu");
      refreshStatus(ctx);
      ctx.ui.notify("已返回主菜单。", "info");
    },
  });

  pi.registerCommand(CMD.context, {
    description: "打印本章上下文包（每段的 token 估算 + 来源）",
    handler: async (args, ctx) => {
      const novel = openNovel();
      if (novel === null) {
        ctx.ui.notify("还没有打开小说。先用 /init 新建一本。", "warning");
        return;
      }
      const chapter = novel.state.currentChapter;
      try {
        const bundle = assemble(novel, chapter);
        const focus = args.trim();
        emit(pi, "novelmaster-context", renderContext(bundle, focus === "" ? undefined : focus));
      } catch (err) {
        // 装配失败要说清原因：这里读七八个文件，静默失败会让用户以为「这份上下文就是空的」。
        ctx.ui.notify(`装配上下文失败：${errorText(err)}`, "error");
      }
    },
  });

  pi.registerCommand(CMD.review, {
    description: "审查（章末自动触发，也可手动补跑）",
    handler: async (_args, ctx) => {
      const novel = openNovel();
      if (novel === null) {
        ctx.ui.notify("还没有打开小说。先用 /init 新建一本。", "warning");
        return;
      }
      try {
        const result = await runReviewAndPersist({
          novel,
          chapter: novel.state.currentChapter,
          cwd: ctx.cwd,
        });
        emit(pi, "novelmaster-review", `${result.text}\n\n──────── 报告全文 ────────\n\n${result.reportMarkdown}`);
      } catch (err) {
        // 审查中止要说清原因：静默失败会让用户以为「这章审过了、没问题」。
        ctx.ui.notify(errorText(err), "error");
      }
    },
  });

  pi.registerCommand(CMD.deai, {
    description: "去 AI 味（章末自动触发，也可手动补跑）",
    handler: async (_args, ctx) => {
      const novel = openNovel();
      if (novel === null) {
        ctx.ui.notify("还没有打开小说。先用 /init 新建一本。", "warning");
        return;
      }
      try {
        const result = await runDeaiWithRecheck({
          novel,
          chapter: novel.state.currentChapter,
          cwd: ctx.cwd,
          onProgress: (message) => ctx.ui.notify(message, "info"),
        });
        emit(
          pi,
          "novelmaster-deai",
          [result.deai.text, result.recheck.text, "", "──────── 去 AI 味报告全文 ────────", "", result.deai.reportMarkdown].join("\n"),
        );
      } catch (err) {
        ctx.ui.notify(errorText(err), "error");
      }
    },
  });

  pi.registerCommand(CMD.brainstorm, {
    description: "按你给定的方向起多 agent 头脑风暴",
    handler: async (args, ctx) => {
      if (getLayer() === "menu") {
        ctx.ui.notify("/brainstorm 要在具体层面里用（/outline、/event、/write）。", "warning");
        return;
      }
      const angle = args.trim();
      if (angle === "") {
        // 硬约束：没有方向不启动（否则容易偏离用户思路）。
        ctx.ui.notify(
          "请给出讨论方向。例：/brainstorm 如果主角其实是内鬼，故事会怎么走？",
          "warning",
        );
        return;
      }
      const novel = openNovel();
      if (novel === null) {
        ctx.ui.notify("还没有打开小说。先用 /init 新建一本。", "warning");
        return;
      }
      emit(pi, "novelmaster-task", renderBrainstormTask(angle));
    },
  });

  pi.registerCommand(CMD.done, {
    description: "验收通过：结章 + 清空上下文",
    handler: async (_args, ctx) => {
      const novel = openNovel();
      if (novel === null) {
        ctx.ui.notify("还没有打开小说。先用 /init 新建一本。", "warning");
        return;
      }

      const chapter = novel.state.currentChapter;
      const state = novel.state;

      // 闸门：**逐条列出缺什么**，而不是只说「不满足条件」——
      // 用户需要知道的是「去做什么」。
      const missing: string[] = [];
      if (state.chapterStatus !== "reflowed") {
        missing.push(`章状态是「${CHAPTER_STATUS_LABEL[state.chapterStatus]}」，需要是「资料已回填」`);
      }
      if (state.pendingReflow) {
        missing.push("pendingReflow 仍为 true —— 你改过正文但资料还没回填");
      }
      if (!exists(chapterSummaryPath(novel.root, chapter))) {
        missing.push(`缺 chapters/${chapterNo(chapter)}.summary.md —— 回填时要写章节摘要`);
      }
      if (missing.length > 0) {
        ctx.ui.notify(
          `还不能结章（闸门读的是 state.json，不是对话里的话）：\n- ${missing.join("\n- ")}\n\n` +
            `在对话里说明现状，我会把该做的做完。`,
          "warning",
        );
        return;
      }

      const advanced = advanceStatus(novel.root, chapter, "reflowed", "accepted");
      if (!advanced) {
        ctx.ui.notify("结章失败：状态在检查与推进之间变了，请重试。", "error");
        return;
      }

      // 清空上下文。`newSession` **只在命令处理器里可用**（事件处理器里会死锁）。
      await ctx.newSession({ parentSession: ctx.sessionManager.getSessionFile() });

      refreshStatus(ctx);
      ctx.ui.notify(
        `第 ${chapterNo(chapter)} 章已结章，上下文已清空。敲 /next 开始第 ${chapterNo(chapter + 1)} 章。`,
        "info",
      );
    },
  });

  pi.registerCommand(CMD.next, {
    description: "推演本章大纲，交你确认",
    handler: async (_args, ctx) => {
      if (getLayer() !== "write") {
        ctx.ui.notify("/next 是写作模式的命令。先 /write 进入。", "warning");
        return;
      }
      const novel = openNovel();
      if (novel === null) {
        ctx.ui.notify("还没有打开小说。先用 /init 新建一本。", "warning");
        return;
      }

      // 只允许从「上一章已验收」或「首次进入」推演新大纲。
      // 在「正文已生成」时又推一份新大纲，会把已经写过的正文悬空。
      let state = novel.state;
      if (state.chapterStatus === "accepted") {
        // 上一章刚结章 —— 先推进章号（「下一章开始了吗」是另一个事实，见 pipeline.md）。
        const next = startNextChapter(novel.root);
        if (next === null) {
          ctx.ui.notify("状态在检查与推进之间变了，请重试。", "error");
          return;
        }
        refreshStatus(ctx);
        ctx.ui.notify(`开始第 ${chapterNo(next)} 章。`, "info");
        const reopened = openNovel();
        if (reopened === null) return;
        state = reopened.state;
      }

      if (state.chapterStatus !== "not_started" && state.chapterStatus !== "accepted") {
        ctx.ui.notify(
          `第 ${state.currentChapter} 章的状态是「${CHAPTER_STATUS_LABEL[state.chapterStatus]}」，此时不推演新大纲。` +
            `先把这一章走完（/context 看喂了什么，/done 结章），或直接告诉 AI 你想改什么。`,
          "warning",
        );
        return;
      }

      try {
        const current = openNovel();
        if (current === null) {
          ctx.ui.notify("小说打不开了 —— 文件可能被改坏了。", "error");
          return;
        }
        emit(pi, "novelmaster-task", renderNextTask(assemble(current, state.currentChapter)));
      } catch (err) {
        ctx.ui.notify(`装配上下文失败：${errorText(err)}`, "error");
      }
    },
  });

  pi.registerCommand(CMD.init, {
    description: "新建一本小说（书名 / 类型 / 核心想法）",
    handler: async (_args, ctx) => {
      await runInit(pi, ctx);
    },
  });

  /* ---------- 层面入口命令 ---------- */

  for (const layer of ENTRY_LAYERS) {
    pi.registerCommand(layer, {
      description: `进入${LAYERS[layer].label}层`,
      handler: async (_args, ctx) => {
        setLayer(layer);
        refreshStatus(ctx);

        // 给用户的清单与注入给 AI 的是同一份（见 docs/design/ai.md「层面数据的装载」）。
        // 进层后对着空屏幕不知道该说什么，是「有哪些条目」这一句能解决的问题。
        const novel = openNovel();
        const data = novel === null ? null : safeLayerData(layer, novel);
        if (data === null) {
          ctx.ui.notify(`进入${LAYERS[layer].label}层。用 /help 看本层命令。`, "info");
          return;
        }
        // 内容过大的层（`/write`）只发摘要：给 AI 的装载与给人的展示不必等量。
        emit(pi, "novelmaster-layer-data", data.userSummary ?? renderLayerData(data));
      },
    });
  }

  /* ---------- 层内命令 ---------- */

  // 尚未实现的命令也要注册。
  // 若只在 /help 里列出却不注册，敲下去会被当成普通文本交给 AI ——
  // 用户以为执行了命令，实际是 AI 在揣摩他的意思。这是最会误导人的形态。
  for (const name of ALL_COMMANDS) {
    const meta = COMMANDS[name];
    if (meta.milestone === undefined) continue;
    pi.registerCommand(name, {
      description: `${meta.desc}（待实现）`,
      handler: async (_args, ctx) => {
        ctx.ui.notify(`/${name} 尚未实现 —— 计划在里程碑 ${meta.milestone} 交付。`, "warning");
      },
    });
  }

  /* ---------- 生命周期 ---------- */

  pi.on("session_start", async (_event, ctx) => {
    refreshStatus(ctx);
  });
}

async function runInit(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const title = (await ctx.ui.input("书名"))?.trim();
  if (!title) {
    ctx.ui.notify("已取消：没有书名。", "info");
    return;
  }

  const genreRaw = (await ctx.ui.input("类型（逗号分隔，可留空）", "例如：科幻, 悬疑")) ?? "";
  const genre = genreRaw
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const premise = (await ctx.ui.editor("核心想法（你最初想到这个故事时脑子里装的东西，不用整理）")) ?? "";
  if (!premise.trim()) {
    ctx.ui.notify("已取消：核心想法为空。没有它，后面所有推断都没有根。", "warning");
    return;
  }

  const root = defaultNovelRoot(slugify(title));

  try {
    const result = initNovel(root, { title, genre, premise: premise.trim() });
    writeConfig({ novelRoot: result.root });
    emit(
      pi,
      "novelmaster-init",
      [
        `已创建小说《${result.meta.title}》`,
        `根目录：${result.root}`,
        `类型：${result.meta.genre.length > 0 ? result.meta.genre.join(" / ") : "（未填）"}`,
        "",
        "已建立的文件：",
        ...result.files.map((f) => `  ${f}`),
        "",
        "下一步：/outline 进入大纲层搭主线，或 /help 看全部命令。",
      ].join("\n"),
    );
  } catch (error) {
    ctx.ui.notify(`建书失败：${(error as Error).message}`, "error");
  }
}
