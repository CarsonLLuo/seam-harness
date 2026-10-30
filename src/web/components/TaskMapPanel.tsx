import { useMemo } from "react";
import type { SeamEvent } from "../../events";
import { taskMap, type MapCall } from "../../insight";
import { useI18n } from "../i18n/i18n";
import { cn } from "@/lib/utils";

/** 任务地图：步骤来自批准的计划；进度由模型自报的步号推出（模型自述），每步下面的调用是 harness 记录的事实 */
export function TaskMapPanel({ events }: { events: SeamEvent[] }) {
  const { t } = useI18n();
  const map = useMemo(() => taskMap(events), [events]);

  if (!map) return <p className="p-4 text-sm leading-relaxed text-muted-foreground">{t.map.empty}</p>;

  return (
    <div className="space-y-4 p-4">
      <p className="text-xs leading-relaxed text-self-report">{t.map.source}</p>
      {map.edited && <p className="text-xs text-muted-foreground">{t.map.edited}</p>}

      <ol className="space-y-3">
        {map.steps.map((s) => (
          <li key={s.index} className="flex gap-3">
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs tabular-nums",
                s.status === "current" ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
              )}
            >
              {s.index}
            </span>
            <div className="min-w-0 flex-1">
              <div className={cn("text-sm leading-snug", s.status === "pending" ? "text-muted-foreground" : "text-foreground", s.status === "current" && "font-medium")}>
                {s.text}
              </div>
              <div className="mt-0.5 text-xs text-self-report">{t.map.status[s.status]}</div>
              {s.calls.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {s.calls.map((c) => (
                    <CallLine key={c.toolCallId} call={c} />
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>

      {map.offPlan.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">{t.map.offPlan}</div>
          <ul className="space-y-1.5">
            {map.offPlan.map((c) => (
              <li key={c.toolCallId}>
                <CallLine call={c} />
                <div className="text-xs text-self-report">{t.map.offPlanReason(c.step)}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CallLine({ call }: { call: MapCall }) {
  const { t } = useI18n();
  const bad = call.outcome === "denied" || call.outcome === "error";
  return (
    <div className="flex min-w-0 items-baseline gap-2 text-xs">
      <span className={cn("shrink-0 font-medium", call.outcome === "running" ? "text-shimmer" : "text-muted-foreground")}>{call.name}</span>
      {call.keyArg && <span className="min-w-0 truncate font-mono text-muted-foreground">{call.keyArg}</span>}
      {bad && <span className="ml-auto shrink-0 text-destructive">{t.map.outcome[call.outcome]}</span>}
    </div>
  );
}
