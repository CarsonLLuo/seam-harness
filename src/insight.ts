// 从事件日志推导任务地图和阅读覆盖。和 replay.ts 一样只读日志，界面和测试共用。
import type { EventPayloads, SeamEvent } from "./events";

/** 工具调用最值得一眼看到的参数 */
export const KEY_ARG: Record<string, string> = { read_file: "path", write_file: "path", search: "pattern", run_command: "command" };

// ---- 任务地图 ----

export interface MapCall {
  toolCallId: string;
  name: string;
  keyArg?: string;
  /** 模型自报的步号；缺失或不是整数时为 undefined */
  step?: number;
  /** harness 记录的结果 */
  outcome: "running" | "ok" | "denied" | "error";
}

export interface MapStep {
  /** 从 1 开始 */
  index: number;
  text: string;
  /** 由模型自报的步号推出来，属于模型自述 */
  status: "done" | "current" | "pending";
  calls: MapCall[];
}

export interface TaskMap {
  steps: MapStep[];
  /** 计划批准之后、模型自报不在计划里（步号为 0、缺失或超出范围）的调用 */
  offPlan: MapCall[];
  /** 用户改过步骤 */
  edited: boolean;
  /** 这次运行已经结束 */
  ended: boolean;
}

interface CallState {
  call: EventPayloads["tool_call"];
  permission?: EventPayloads["permission"];
  result?: EventPayloads["tool_result"];
}

function outcomeOf(c: CallState): MapCall["outcome"] {
  if (c.permission?.decision === "deny") return "denied";
  if (!c.result) return "running";
  return c.result.isError ? "error" : "ok";
}

function toMapCall(c: CallState): MapCall {
  const { toolCallId, name, args } = c.call;
  const key = args[KEY_ARG[name] ?? ""];
  const step = args.step;
  return {
    toolCallId,
    name,
    keyArg: typeof key === "string" ? key : undefined,
    step: typeof step === "number" && Number.isInteger(step) ? step : undefined,
    outcome: outcomeOf(c),
  };
}

/**
 * 当前这次运行里最近被批准的计划，以及之后每次调用按模型自报的步号归到哪一步。
 * 计划按一次运行算（每次提问都要重新批准），所以用户发出新消息后旧计划不再显示。
 * 这次运行还没有被批准的计划时返回 undefined。
 */
export function taskMap(events: SeamEvent[]): TaskMap | undefined {
  const calls = new Map<string, CallState>();
  let plan: { steps: string[]; edited: boolean } | undefined;
  let after: CallState[] = [];
  let ended = false;

  for (const e of events) {
    switch (e.type) {
      case "tool_call": {
        const c: CallState = { call: e.data };
        calls.set(e.data.toolCallId, c);
        if (plan && e.data.name !== "propose_plan") after.push(c);
        break;
      }
      case "permission": {
        const c = calls.get(e.data.toolCallId);
        if (c) c.permission = e.data;
        break;
      }
      case "tool_result": {
        const c = calls.get(e.data.toolCallId);
        if (c) c.result = e.data;
        const d = e.data.details as { steps?: unknown; edited?: unknown } | undefined;
        if (e.data.name === "propose_plan" && !e.data.isError && c?.permission?.decision !== "deny" && Array.isArray(d?.steps)) {
          plan = { steps: d.steps.map(String), edited: d.edited === true };
          after = [];
          ended = false;
        }
        break;
      }
      case "user_message":
        plan = undefined;
        after = [];
        ended = false;
        break;
      case "session_end":
        if (plan) ended = true;
        break;
    }
  }
  if (!plan) return undefined;

  const n = plan.steps.length;
  const mapped = after.map(toMapCall);
  const inPlan = (c: MapCall) => c.step !== undefined && c.step >= 1 && c.step <= n;
  const current = mapped.filter(inPlan).at(-1)?.step;
  const steps: MapStep[] = plan.steps.map((text, i) => {
    const index = i + 1;
    const own = mapped.filter((c) => c.step === index);
    let status: MapStep["status"] = "pending";
    if (current !== undefined) {
      if (index === current) status = ended ? "done" : "current";
      else if (index < current || own.length > 0) status = "done";
    }
    return { index, text, status, calls: own };
  });
  return { steps, offPlan: mapped.filter((c) => !inPlan(c)), edited: plan.edited, ended };
}

// ---- 阅读覆盖 ----

export interface FileCoverage {
  /** 读过的行范围（闭区间，从 1 开始），已合并并排序 */
  ranges: [number, number][];
  /** 最近一次读取时文件的总行数 */
  total: number;
  /** 全部行都读过（空文件读一次即算） */
  full: boolean;
}

export interface ReadCoverage {
  /** 键是相对工作区根目录的路径 */
  files: Record<string, FileCoverage>;
  /** harness 在会话开始时注入系统提示词的说明文件；不是模型主动读取的 */
  injected?: string;
}

function merge(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [from, to] of sorted) {
    const last = out.at(-1);
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

/** 只认成功的 read_file 结果：被拒绝、出错的读取不算读过 */
export function readCoverage(events: SeamEvent[]): ReadCoverage {
  const files: Record<string, FileCoverage> = {};
  let injected: string | undefined;
  for (const e of events) {
    if (e.type === "session_start" && e.data.workspaceNote) injected = e.data.workspaceNote.path;
    if (e.type !== "tool_result" || e.data.name !== "read_file" || e.data.isError) continue;
    const d = e.data.details as { path?: unknown; from?: unknown; to?: unknown; total?: unknown } | undefined;
    if (typeof d?.path !== "string" || typeof d.from !== "number" || typeof d.to !== "number" || typeof d.total !== "number") continue;
    const prev = files[d.path];
    const ranges = merge(d.to >= d.from ? [...(prev?.ranges ?? []), [d.from, d.to]] : (prev?.ranges ?? []));
    const full = d.total === 0 || (ranges.length > 0 && ranges[0]![0] <= 1 && ranges[0]![1] >= d.total);
    files[d.path] = { ranges, total: d.total, full };
  }
  return { files, injected };
}

// ---- 按次查看 ----

/** 用户每发一条消息开始一次运行（第一次是任务，之后是追问） */
export interface Run {
  /** 从 1 开始 */
  index: number;
  text: string;
}

function userText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c: any) => c?.type === "text")
    .map((c: any) => c.text as string)
    .join("\n");
}

export function listRuns(events: SeamEvent[]): Run[] {
  return events
    .filter((e) => e.type === "user_message")
    .map((e, i) => ({ index: i + 1, text: e.type === "user_message" ? userText(e.data.content) : "" }));
}

/**
 * 第 run 次运行结束时的累计覆盖（模型当时上下文里有的内容），以及这一次运行里读到的部分。
 * 追问会带上之前的全部工具结果，所以累计覆盖才是模型“当时知道什么”。
 */
export function coverageAtRun(events: SeamEvent[], run: number): { total: ReadCoverage; current: ReadCoverage } {
  const starts = events.flatMap((e, i) => (e.type === "user_message" ? [i] : []));
  const start = starts[run - 1] ?? events.length;
  const end = starts[run] ?? events.length;
  return { total: readCoverage(events.slice(0, end)), current: readCoverage(events.slice(start, end)) };
}
