import type { Request, Result } from "./bank/operations";

/** Native command palette actions; parameterized requests use runAutomation via eval. */
export const bankCommands: { id: string; name: string; request: Request }[] = [
  { id: "check-bank", name: "检查完整知识库", request: { operation: "check" } },
  { id: "index", name: "更新知识库索引", request: { operation: "index" } },
  { id: "schema", name: "生成词表文档", request: { operation: "schema" } },
  { id: "lift-preview", name: "预览断言迁入属性", request: { operation: "lift", dryRun: true } },
  { id: "lift", name: "将无范围断言迁入属性", request: { operation: "lift" } },
  { id: "sources-preview", name: "预览原生证据链接迁移", request: { operation: "sources", dryRun: true } },
  { id: "sources", name: "迁移原生证据链接", request: { operation: "sources" } },
  { id: "info", name: "读取知识库实例信息", request: { operation: "info" } },
  { id: "review", name: "列出待审文档", request: { operation: "review" } },
];
const failure = (error: string): Result => ({ apiVersion: 1, code: 2, data: { error }, changes: [] });

/** command CLI does not await callbacks. Retain the latest invocation's promise,
 * including failures; an earlier run must never overwrite a later result. */
export class CommandResults {
  private latest?: { id: string; pending: Promise<Result> };
  start(id: string, run: () => Promise<Result>): Promise<Result> {
    const pending = Promise.resolve().then(run).catch(e => failure(String(e instanceof Error ? e.message : e)));
    this.latest = { id, pending };
    return pending;
  }
  async result(expectedId?: string): Promise<Result & { commandId?: string }> {
    const latest = this.latest;
    if (!latest) return failure("no Noteweave bank command has run since plugin load");
    if (expectedId && latest.id !== expectedId)
      return failure(`latest command is ${latest.id}, expected ${expectedId}; use runAutomation for an isolated result`);
    return { ...await latest.pending, commandId: latest.id };
  }
}

export function commandSummary(request: Request, result: Result): string {
  if (result.code === 2) return `Noteweave：${result.data.error}`;
  if (request.operation === "check") return `Noteweave：${result.data.errors} 错误，${result.data.warnings} 警告`;
  const mode = request.dryRun ? "预览" : "完成";
  return `Noteweave ${request.operation} ${mode}（code=${result.code}）；详细结果可用 Obsidian eval 读取 commandResult()`;
}
