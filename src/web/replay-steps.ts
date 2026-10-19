import type { SeamEvent } from "../events";

/** 回放时不单独成为一步的事件：它们在界面上不产生可见变化 */
const SILENT = new Set<SeamEvent["type"]>(["http_response", "turn_end"]);

/** 回放的每一步对应一条可见事件，返回这些事件在日志里的下标 */
export function replaySteps(events: SeamEvent[]): number[] {
  return events.flatMap((e, i) => (SILENT.has(e.type) ? [] : [i]));
}

/** 回放到第 step 步（从 0 开始）时，界面应当看到的事件 */
export function eventsAtStep(events: SeamEvent[], steps: number[], step: number): SeamEvent[] {
  const last = steps[Math.max(0, Math.min(step, steps.length - 1))];
  return last === undefined ? [] : events.slice(0, last + 1);
}
