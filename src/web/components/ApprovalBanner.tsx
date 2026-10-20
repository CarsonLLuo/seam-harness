import { Check, Pencil, Plus, ShieldQuestion, Trash2, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ApprovalDecision, ApprovalRequest } from "../api";
import { useI18n } from "../i18n/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 待确认的请求。出现时替代对话底部的输入框（参考 Proma 的 ExitPlanModeBanner）：
 * 位置固定，用户总能看见；不在工具行里再套一层卡片。
 * 结构参考 Proma 的 PermissionBanner：一行标题、一块内容、一行小按钮，右上角 × 停止运行。
 */
export function ApprovalBanner({
  request,
  count,
  onRespond,
  onStop,
}: {
  request: ApprovalRequest;
  /** 队列里还有多少个，目前串行执行所以通常是 1 */
  count: number;
  onRespond: (body: ApprovalDecision) => Promise<void>;
  /** 停止这次运行；横幅出现时输入框隐藏，停止按钮放在这里 */
  onStop: () => void;
}) {
  const { t } = useI18n();
  const isPlan = request.preview?.kind === "plan";
  const [busy, setBusy] = useState(false);
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [steps, setSteps] = useState<string[]>(() =>
    request.preview?.kind === "plan" ? request.preview.steps : [],
  );
  const intent = typeof request.args.intent === "string" ? request.args.intent : undefined;

  const respond = async (body: ApprovalDecision) => {
    if (busy) return;
    setBusy(true);
    try {
      await onRespond(body);
    } finally {
      setBusy(false);
    }
  };

  const approve = () =>
    respond(isPlan ? { decision: "allow", steps: steps.map((s) => s.trim()).filter(Boolean) } : { decision: "allow" });
  const approveRef = useRef(approve);
  approveRef.current = approve;

  // Enter 批准；正在拒绝时、焦点在输入框里时不拦截（拒绝理由和步骤编辑要用 Enter）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && denying) {
        e.preventDefault();
        setDenying(false);
        return;
      }
      if (e.key !== "Enter" || e.isComposing || denying) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, a, [contenteditable='true']")) return;
      e.preventDefault();
      void approveRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [denying]);

  const canApprove = !busy && (!isPlan || steps.some((s) => s.trim() !== ""));

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 rounded-xl bg-card shadow-lg ring-1 ring-black/5 duration-200 ease-smooth dark:ring-white/5">
      <div className="space-y-2.5 px-4 pt-3 pb-2.5">
        {/* 标题 + 模型给出的理由 */}
        <div className="flex items-start gap-2.5">
          <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/12 text-amber-600 dark:text-amber-400">
            <ShieldQuestion className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[14px] font-medium">{isPlan ? t.approval.planTitle : t.approval.title}</span>
              {count > 1 && <span className="text-[12px] text-muted-foreground">+{count - 1}</span>}
              <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">{request.name}</span>
              <button
                type="button"
                onClick={onStop}
                title={t.approval.stopRun}
                aria-label={t.approval.stopRun}
                className="-mr-1 flex h-5 w-5 shrink-0 items-center justify-center self-center rounded-md text-muted-foreground/50 transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {intent && (
              <p className="mt-0.5 text-[12px] leading-relaxed text-self-report" title={t.source.model}>
                <span className="font-medium">{t.modelSays}</span> <span className="italic">{intent}</span>
              </p>
            )}
          </div>
        </div>

        {/* 请求的具体内容 */}
        <div className="pl-8.5">
          {isPlan ? (
            <ol className="space-y-1.5">
              {steps.map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px] leading-snug">
                  <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  {editing ? (
                    <>
                      <input
                        value={step}
                        onChange={(e) => setSteps((prev) => prev.map((s, j) => (j === i ? e.target.value : s)))}
                        aria-label={t.approval.stepLabel(i + 1)}
                        className="-my-1 h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[13px] outline-none transition-colors focus-visible:border-ring/50"
                      />
                      <button
                        type="button"
                        aria-label={t.approval.removeStep}
                        onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
                        className="-my-0.5 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <span className="min-w-0 flex-1 pt-px">{step}</span>
                  )}
                </li>
              ))}
              {editing && (
                <li>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setSteps((prev) => [...prev, ""])}
                    className="flex items-center gap-2 rounded-md py-0.5 pr-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-border">
                      <Plus className="h-3 w-3" />
                    </span>
                    {t.approval.addStep}
                  </button>
                </li>
              )}
            </ol>
          ) : request.preview?.kind === "write_file" ? (
            <div className="overflow-hidden rounded-lg border border-border/60">
              <div className="flex items-center gap-2 bg-muted/40 px-2.5 py-1.5">
                <span className="rounded bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {request.preview.created ? t.approval.writeCreate : t.approval.writeOverwrite}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{request.preview.path}</span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums">
                  <span className="text-fact">+{request.preview.added}</span>{" "}
                  <span className="text-destructive">−{request.preview.removed}</span>
                </span>
              </div>
              {request.preview.diff && (
                <pre className="max-h-40 overflow-auto py-1 font-mono text-[12px] leading-5">
                  {request.preview.diff.split("\n").map((line, i) => (
                    <div
                      key={i}
                      className={cn(
                        "px-2.5",
                        line.startsWith("+") && "bg-fact/10 text-fact",
                        line.startsWith("-") && "bg-destructive/10 text-destructive",
                      )}
                    >
                      {line || " "}
                    </div>
                  ))}
                </pre>
              )}
            </div>
          ) : request.preview?.kind === "run_command" ? (
            <>
              <pre className="max-h-32 overflow-auto rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5 font-mono text-[12px] leading-5 whitespace-pre-wrap break-all">
                <span className="text-muted-foreground select-none">$ </span>
                {request.preview.command}
              </pre>
              <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-relaxed text-amber-700 dark:text-amber-300">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t.approval.commandWarning}
              </p>
            </>
          ) : null}
        </div>
      </div>

      {/* 操作 */}
      <div className="flex items-center gap-1.5 px-3 pb-3 pl-12.5">
        {denying ? (
          <>
            <input
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void respond({ decision: "deny", reason: reason.trim() || undefined });
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setDenying(false);
                }
              }}
              placeholder={t.approval.denyReason}
              disabled={busy}
              className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[12px] outline-none transition-colors focus-visible:border-ring/50"
            />
            <Button variant="ghost" size="sm" className="h-7 px-2.5 text-[12px]" disabled={busy} onClick={() => setDenying(false)}>
              {t.approval.denyCancel}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="h-7 px-3 text-[12px]"
              disabled={busy}
              onClick={() => void respond({ decision: "deny", reason: reason.trim() || undefined })}
            >
              {t.approval.denyConfirm}
            </Button>
          </>
        ) : (
          <>
            <span className="mr-auto truncate text-[11px] text-muted-foreground/60">
              {t.approval.requestedBy} · {t.approval.enterHint}
            </span>
            {isPlan && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-[12px] text-muted-foreground"
                disabled={busy}
                onClick={() => setEditing((v) => !v)}
              >
                {editing ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                {editing ? t.approval.editDone : t.approval.edit}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2.5 text-[12px] text-muted-foreground hover:text-destructive"
              disabled={busy}
              onClick={() => setDenying(true)}
            >
              <X className="h-3.5 w-3.5" />
              {t.approval.deny}
            </Button>
            <Button size="sm" className="h-7 px-3 text-[12px]" disabled={!canApprove} onClick={() => void approve()}>
              <Check className="h-3.5 w-3.5" />
              {t.approval.approve}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
