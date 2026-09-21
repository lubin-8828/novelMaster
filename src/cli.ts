import process from "node:process";
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  InteractiveMode,
  SessionManager,
  type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";
import { novelMasterExtension } from "./extension/index.ts";

const cwd = process.cwd();
const agentDir = getAgentDir();

/**
 * 运行时工厂。
 *
 * 把 novelMaster 扩展挂进 ResourceLoader，之后每次会话替换（/new、/done 清空上下文）
 * 都会重新走这里，扩展也就会重新绑定 —— 这是"每章清空上下文"能正常工作的前提。
 */
const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    resourceLoaderOptions: {
      extensionFactories: [{ name: "novelmaster", factory: novelMasterExtension }],
    },
  });

  return {
    ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })),
    services,
    diagnostics: services.diagnostics,
  };
};

const runtime = await createAgentSessionRuntime(createRuntime, {
  cwd,
  agentDir,
  sessionManager: SessionManager.create(cwd),
});

for (const d of runtime.diagnostics) {
  if (d.type === "error") process.stderr.write(`[novelmaster] 错误：${d.message}\n`);
  else if (d.type === "warning") process.stderr.write(`[novelmaster] 警告：${d.message}\n`);
}

const mode = new InteractiveMode(runtime, {
  modelFallbackMessage: runtime.modelFallbackMessage,
});

await mode.run();
