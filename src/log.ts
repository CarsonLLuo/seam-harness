// 事件日志：每个会话一个 JSONL 文件，只追加写入。
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_VERSION, type EventPayloads, type EventType, type SeamEvent, type Source } from "./events";

export class EventLog {
  private seq = 0;
  /** 当前轮次；turn_start 时加一，之前的记录（如 session_start）属于第 0 轮 */
  turn = 0;

  constructor(
    readonly path: string,
    readonly sessionId: string,
    private readonly onRecord?: (event: SeamEvent) => void,
  ) {
    mkdirSync(dirname(path), { recursive: true });
  }

  record = <K extends EventType>(type: K, source: Source, data: EventPayloads[K]): void => {
    if (type === "turn_start") this.turn++;
    const event = {
      v: SCHEMA_VERSION,
      seq: ++this.seq,
      ts: Date.now(),
      sessionId: this.sessionId,
      turn: this.turn,
      type,
      source,
      data,
    } as SeamEvent;
    // 同步追加，保证日志顺序与事件发生顺序一致
    appendFileSync(this.path, `${JSON.stringify(event)}\n`);
    this.onRecord?.(event);
  };
}

export function readLog(path: string): SeamEvent[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as SeamEvent);
}
