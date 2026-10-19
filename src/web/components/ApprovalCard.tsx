import { Plus, ShieldQuestion, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ApprovalDecision, ApprovalRequest } from "../api";
import { useI18n } from "../i18n/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * 待确认的请求。不是模型自己弹出来的：harness 把模型的请求挂起，交到这里。
 * 写文件显示 diff，执行命令显示原文并提示不受工作区限制，计划可以逐条修改。
 */
export function ApprovalCard({
  request,
  onRespond,
}: {
  request: ApprovalRequest;
  onRespond: (body: ApprovalDecision) => Promise<void>;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const isPlan = request.preview?.kind === "plan";
  const [steps, setSteps] = useState<string[]>(() =>
    request.preview?.kind === "plan" ? request.preview.steps : [],
  );

  const respond = async (body: ApprovalDecision) => {
    setBusy(true);
    try {
      await onRespond(body);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-3 mb-2 rounded-lg border border-amber-500/35 bg-amber-500/5 p-3 text-sm">
      <div className="flex items-center gap-2">
        <ShieldQuestion className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="font-medium">{t.approval.title}</span>
        <span className="ml-auto shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">
          {t.approval.paused}
        </span>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{t.approval.gate}</p>

      {request.preview?.kind === "write_file" && (
        <div className="mt-2 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {request.preview.created ? t.approval.writeCreate : t.approval.writeOverwrite}
            </span>
            <span className="min-w-0 break-all font-mono text-[13px]">{request.preview.path}</span>
            <span className="text-xs text-muted-foreground">
              {t.approval.lines(request.preview.added, request.preview.removed)}
            </span>
          </div>
          {request.preview.diff && (
            <pre className="max-h-52 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-xs leading-relaxed whitespace-pre">
              {request.preview.diff.split("\n").map((line, i) => (
                <div key={i} className={cn(line.startsWith("+") && "text-fact", line.startsWith("-") && "text-destructive")}>
                  {line || " "}
                </div>
              ))}
            </pre>
          )}
        </div>
      )}

      {request.preview?.kind === "run_command" && (
        <div className="mt-2 space-y-1.5">
          <pre className="max-h-40 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
            {request.preview.command}
          </pre>
          <p className="text-xs text-amber-700 dark:text-amber-300">{t.approval.commandWarning}</p>
        </div>
      )}

      {isPlan && (
        <div className="mt-2 space-y-1.5">
          <p className="text-xs text-muted-foreground">{t.approval.planHint}</p>
          {steps.map((step, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-4 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
              <input
                value={step}
                onChange={(e) => setSteps((prev) => prev.map((s, j) => (j === i ? e.target.value : s)))}
                aria-label={t.approval.stepLabel(i + 1)}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-[13px] outline-none transition-colors focus-visible:border-ring/40"
              />
              <button
                type="button"
                aria-label={t.approval.removeStep}
                onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
                className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setSteps((prev) => [...prev, ""])}>
            <Plus className="h-3.5 w-3.5" />
            {t.approval.addStep}
          </Button>
        </div>
      )}

      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t.approval.denyReason}
        rows={1}
        disabled={busy}
        className="mt-3 min-h-[36px] text-[13px]"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void respond({ decision: "deny", reason: reason.trim() || undefined })}
        >
          {t.approval.deny}
        </Button>
        <Button
          size="sm"
          disabled={busy || (isPlan && steps.every((s) => s.trim() === ""))}
          onClick={() =>
            void respond(
              isPlan
                ? { decision: "allow", steps: steps.map((s) => s.trim()).filter(Boolean) }
                : { decision: "allow" },
            )
          }
        >
          {t.approval.approve}
        </Button>
      </div>
    </div>
  );
}
