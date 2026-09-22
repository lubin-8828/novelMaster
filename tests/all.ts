/**
 * 测试总入口。`npm test` 跑这个文件。
 *
 * 顺序：装配与文档 → 数据层 → 工具层。后一个依赖前一个已经验证过的能力，
 * 所以前面失败时，后面的失败信息会明显变得没意义 —— 先看最上面那一屏。
 */

import { finish } from "./harness.ts";
import runSmoke from "./smoke.ts";
import runLayers from "./layers.ts";
import runData from "./data.ts";
import runTools from "./tools.ts";
import runBrainstorm from "./brainstorm.ts";
import runContext from "./context.ts";
import runReport from "./report.ts";
import runDeai from "./deai.ts";

await runSmoke();
await runLayers();
runData();
await runTools();
await runBrainstorm();
runContext();
await runReport();
await runDeai();

finish();
