import { ChevronLeft, ChevronRight, SkipBack, SkipForward } from "lucide-react";
import { useI18n } from "../i18n/i18n";
import { Slider } from "@/components/ui/slider";
import { IconButton } from "./IconButton";

/** 回放控制条：打开回放开关后替代输入框，显示在底部 */
export function ReplayBar({ steps, step, onStep }: { steps: number; step: number; onStep: (s: number) => void }) {
  const { t } = useI18n();
  const go = (s: number) => onStep(Math.max(0, Math.min(steps - 1, s)));
  return (
    <div className="flex items-center gap-1 rounded-2xl border border-border bg-input-surface px-2 py-1.5 shadow-sm">
      <IconButton label={t.replay.first} onClick={() => go(0)} disabled={step === 0}>
        <SkipBack />
      </IconButton>
      <IconButton label={t.replay.prev} onClick={() => go(step - 1)} disabled={step === 0}>
        <ChevronLeft />
      </IconButton>
      <IconButton label={t.replay.next} onClick={() => go(step + 1)} disabled={step === steps - 1}>
        <ChevronRight />
      </IconButton>
      <IconButton label={t.replay.last} onClick={() => go(steps - 1)} disabled={step === steps - 1}>
        <SkipForward />
      </IconButton>
      <Slider
        className="mx-3 min-w-16 flex-1"
        min={0}
        max={Math.max(0, steps - 1)}
        step={1}
        value={[step]}
        onValueChange={([v]) => go(v ?? 0)}
        aria-label={t.replay.toggle}
      />
      <span className="pr-2 text-sm whitespace-nowrap text-muted-foreground tabular-nums">{t.replay.step(step + 1, steps)}</span>
    </div>
  );
}
