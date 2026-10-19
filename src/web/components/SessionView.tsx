import { useEffect, useMemo, useState } from "react";
import type { SeamEvent } from "../../events";
import { reconstruct, type ReplayToolCall, type ReplayTurn } from "../../replay";
import { stopSession, subscribe } from "../api";
import { useI18n } from "../i18n/i18n";
import { eventsAtStep, replaySteps } from "../replay-steps";
import { StatusBadge } from "./StatusBadge";

type Raw = (value: unknown) => void;

function textOf(content: unknown[] | undefined): string {
  return (content ?? [])
    .filter((c: any) => c?.type === "text")
    .map((c: any) => c.text as string)
    .join("\n")
    .trim();
}

export function SessionView({ sessionId, onRaw, onEnded }: { sessionId: string; onRaw: Raw; onEnded: () => void }) {
  const { t } = useI18n();
  const [events, setEvents] = useState<SeamEvent[]>([]);
  const [deltas, setDeltas] = useState<Record<number, string>>({});
  const [ended, setEnded] = useState(false);
  /** null 表示显示全部（实时或已结束的完整会话）；数字表示回放到第几步 */
  const [step, setStep] = useState<number | null>(null);

  useEffect(
    () =>
      subscribe(sessionId, (m) => {
        if (m.kind === "event") setEvents((prev) => [...prev, m.event]);
        else if (m.kind === "delta") setDeltas((prev) => ({ ...prev, [m.turn]: (prev[m.turn] ?? "") + m.text }));
        else {
          setEnded(true);
          onEnded();
        }
      }),
    [sessionId, onEnded],
  );

  const steps = useMemo(() => replaySteps(events), [events]);
  const visible = step === null ? events : eventsAtStep(events, steps, step);
  const session = useMemo(() => reconstruct(visible), [visible]);
  const start = session.start;
  const running = !ended;
  // 头部状态反映整个会话，不随回放位置变化
  const finalEnd = useMemo(() => events.findLast((e) => e.type === "session_end"), [events]);
  const status = running ? "running" : finalEnd?.type === "session_end" ? finalEnd.data.reason : "unknown";

  if (!start) return null;

  return (
    <div className="mx-auto max-w-3xl px-8 pt-8 pb-24">
      <header className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl leading-snug font-semibold tracking-tight">{start.task}</h1>
          {running && (
            <button
              onClick={() => stopSession(sessionId).catch(() => undefined)}
              className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
            >
              {t.stop}
            </button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <StatusBadge status={status} />
          <span>
            {start.model.provider}/{start.model.id}
          </span>
          <span className="font-mono text-xs">{start.workspace}</span>
        </div>
      </header>

      {ended && steps.length > 0 && <ReplayBar steps={steps.length} step={step} onStep={setStep} />}

      <div className="space-y-4">
        {session.turns.map((turn) => (
          <Turn
            key={turn.turn}
            turn={turn}
            streaming={step === null && !turn.assistant ? deltas[turn.turn] : undefined}
            onRaw={onRaw}
          />
        ))}
      </div>

      {session.end && (
        <p className="mt-6 text-sm text-muted-foreground">
          {t.end(t.status[session.end.reason], (session.end.durationMs / 1000).toFixed(1))}
          {session.end.errorMessage && <span className="text-destructive"> — {session.end.errorMessage}</span>}
        </p>
      )}
    </div>
  );
}

function ReplayBar({ steps, step, onStep }: { steps: number; step: number | null; onStep: (s: number | null) => void }) {
  const { t } = useI18n();
  const current = step ?? steps - 1;
  const go = (s: number) => onStep(Math.max(0, Math.min(steps - 1, s)));
  const btn = "rounded-md px-2 py-1 text-sm hover:bg-muted disabled:opacity-30";
  return (
    <div className="sticky top-0 z-10 mb-5 flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
      <span className="mr-2 text-sm font-medium whitespace-nowrap">{t.replay.label}</span>
      <button className={btn} onClick={() => go(0)} disabled={current === 0} aria-label={t.replay.first} title={t.replay.first}>
        ⏮
      </button>
      <button className={btn} onClick={() => go(current - 1)} disabled={current === 0} aria-label={t.replay.prev} title={t.replay.prev}>
        ◀
      </button>
      <button
        className={btn}
        onClick={() => go(current + 1)}
        disabled={current === steps - 1}
        aria-label={t.replay.next}
        title={t.replay.next}
      >
        ▶
      </button>
      <button
        className={btn}
        onClick={() => onStep(null)}
        disabled={current === steps - 1}
        aria-label={t.replay.last}
        title={t.replay.last}
      >
        ⏭
      </button>
      <input
        type="range"
        min={0}
        max={steps - 1}
        value={current}
        onChange={(e) => go(Number(e.target.value))}
        className="mx-3 flex-1"
        aria-label={t.replay.label}
      />
      <span className="text-sm whitespace-nowrap text-muted-foreground tabular-nums">{t.replay.step(current + 1, steps)}</span>
    </div>
  );
}

function Turn({ turn, streaming, onRaw }: { turn: ReplayTurn; streaming?: string; onRaw: Raw }) {
  const { t } = useI18n();
  const request = turn.requests.at(-1);
  const body = request?.body as { messages?: unknown[]; tools?: unknown[] } | undefined;
  const text = turn.assistant ? textOf(turn.assistant.content) : streaming;
  const usage = turn.assistant?.usage as
    | { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
    | undefined;
  const input = usage ? (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0) : undefined;

  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{t.turn(turn.turn)}</span>
        {request && (
          <button onClick={() => onRaw(request)} className="rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground">
            {t.request(body?.messages?.length ?? 0, body?.tools?.length ?? 0)} · {t.viewRaw}
          </button>
        )}
      </div>

      {text && (
        <div className="text-[15px] leading-relaxed whitespace-pre-wrap">
          {text}
          {!turn.assistant && <span className="ml-1 text-muted-foreground">{t.streaming}</span>}
        </div>
      )}
      {turn.assistant?.errorMessage && <p className="mt-2 text-sm text-destructive">{turn.assistant.errorMessage}</p>}

      {turn.toolCalls.length > 0 && (
        <ul className={`space-y-3 ${text ? "mt-4" : ""}`}>
          {turn.toolCalls.map((c) => (
            <ToolCall key={c.call.toolCallId} call={c} onRaw={onRaw} />
          ))}
        </ul>
      )}

      {usage && input !== undefined && (
        <div className="mt-3 text-xs text-muted-foreground tabular-nums">{t.tokens(input, usage.output ?? 0)}</div>
      )}
    </section>
  );
}

function ToolCall({ call, onRaw }: { call: ReplayToolCall; onRaw: Raw }) {
  const { t } = useI18n();
  const { intent, ...args } = call.call.args;
  const permission = call.permission;
  const result = call.result;
  const resultText = result ? textOf(result.content) : "";
  const permissionLabel = permission
    ? permission.decision === "deny"
      ? t.permission.deny
      : permission.by === "auto"
        ? t.permission.allowAuto
        : t.permission.allowUser
    : undefined;

  return (
    <li className="rounded-md bg-muted/60 px-3 py-2.5">
      <button onClick={() => onRaw(call)} className="block w-full text-left font-mono text-[13px] hover:underline">
        {call.call.name}
        <span className="text-muted-foreground">({JSON.stringify(args).slice(1, -1)})</span>
      </button>

      {/* 模型自述：专用颜色、虚线竖条、明确标注 */}
      <div className="mt-1.5 border-l-2 border-dashed border-self-report pl-2 text-sm text-self-report" title={t.source.model}>
        <span className="font-medium">{t.modelSays}</span>{" "}
        <span className="italic">{typeof intent === "string" ? intent : t.intentMissing}</span>
      </div>

      {/* harness 记录的事实 */}
      <div className="mt-1.5 space-y-1 text-sm" title={t.source.harness}>
        {permissionLabel && (
          <div className={permission?.decision === "deny" ? "text-destructive" : "text-fact"}>
            {permission?.decision === "deny" ? "✕" : "✓"} {permissionLabel}
            {permission?.reason && <span className="text-muted-foreground"> — {permission.reason}</span>}
          </div>
        )}
        {/* 被拒绝时，结果就是拒绝理由，不再重复显示 */}
        {result && !(permission?.decision === "deny" && resultText === permission.reason) && (
          <div className="line-clamp-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            <span className={result.isError ? "text-destructive" : "text-foreground"}>
              {result.isError ? t.resultError : t.result}
            </span>{" "}
            {resultText}
          </div>
        )}
      </div>
    </li>
  );
}
