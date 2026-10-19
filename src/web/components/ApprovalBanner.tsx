import { Check, Pencil, Plus, ShieldQuestion, Trash2, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ApprovalDecision, ApprovalRequest } from "../api";
import { useI18n } from "../i18n/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 待确认的请求。放在对话底部、输入框上方：位置固定，用户总能看见；
 * 不在工具行里再套一层卡片。结构和 Proma 的 PermissionBanner 一致：
 * 一行标题、一块内容、一行小按钮。
 */
export function ApprovalBanner({
  request,
  count,
  onRespond,
}: {
  request: ApprovalRequest;
  /** 队列里还有多少个，目前串行执行所以通常是 1 */
  count: number;
  onRespond: (body: ApprovalDecision) => Promise<void>;
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

  // Enter 批准；焦点在输入框里时不拦截（拒绝理由和步骤编辑要用 Enter）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && denying) {
        e.preventDefault();
        setDenying(false);
        return;
      }
      if (e.key !== "Enter" || e.isComposing) return;
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
    <div className="mb-2 animate-in fade-in slide-in-from-bottom-2 overflow-hidden rounded-xl border border-border bg-card shadow-lg duration-200 ease-smooth">
      <div className="flex items-center gap-2 border-b border-border/70 px-3.5 py-2.5">
        <ShieldQuestion className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="font-medium">{isPlan ? t.approval.planTitle : t.approval.title}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{request.name}</span>
        {count > 1 && <span className="text-[11px] text-muted-foreground">+{count - 1}</span>}
        <span className="ml-auto text-[11px] text-muted-foreground">{t.approval.requestedBy}</span>
      </div>

      <div className="px-3.5 py-2.5">
        {isPlan ? (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground">{t.approval.planSection}</span>
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
              >
                {editing ? <Check className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                {editing ? t.approval.editDone : t.approval.edit}
              </button>
            </div>
            <div className="mt-1.5 space-y-1">
              {steps.map((step, i) =>
                editing ? (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{i + 1}</span>
                    <input
                      value={step}
                      onChange={(e) => setSteps((prev) => prev.map((s, j) => (j === i ? e.target.value : s)))}
                      aria-label={t.approval.stepLabel(i + 1)}
                      className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[12px] outline-none transition-colors focus-visible:border-ring/50"
                    />
                    <button
                      type="button"
                      aria-label={t.approval.removeStep}
                      onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
                      className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <div key={i} className="flex gap-2 text-[13px] leading-snug">
                    <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{i + 1}</span>
                    <span className="min-w-0 flex-1">{step}</span>
                  </div>
                ),
              )}
              {editing && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  disabled={busy}
                  onClick={() => setSteps((prev) => [...prev, ""])}
                >
                  <Plus className="h-3 w-3" />
                  {t.approval.addStep}
                </Button>
              )}
            </div>
          </>
        ) : request.preview?.kind === "write_file" ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {request.preview.created ? t.approval.writeCreate : t.approval.writeOverwrite}
              </span>
              <span className="min-w-0 break-all font-mono text-[13px]">{request.preview.path}</span>
              <span className="text-[11px] text-muted-foreground">
                {t.approval.lines(request.preview.added, request.preview.removed)}
              </span>
            </div>
            {request.preview.diff && (
              <pre className="mt-1.5 max-h-36 overflow-auto rounded-md bg-muted/50 px-2 py-1.5 font-mono text-[11px] leading-5">
                {request.preview.diff.split("\n").map((line, i) => (
                  <div key={i} className={cn(line.startsWith("+") && "text-fact", line.startsWith("-") && "text-destructive")}>
                    {line || " "}
                  </div>
                ))}
              </pre>
            )}
          </>
        ) : request.preview?.kind === "run_command" ? (
          <>
            <pre className="max-h-32 overflow-auto rounded-md bg-muted/50 px-2 py-1.5 font-mono text-[11px] leading-5 whitespace-pre-wrap break-all">
              {request.preview.command}
            </pre>
            <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
              <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
              {t.approval.commandWarning}
            </p>
          </>
        ) : null}

        {intent && (
          <div
            className="mt-2 border-l-2 border-dashed border-self-report pl-2 text-[12px] leading-relaxed text-self-report"
            title={t.source.model}
          >
            <span className="font-medium">{t.modelSays}</span> <span className="italic">{intent}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border/70 bg-muted/30 px-3.5 py-2">
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
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" disabled={busy} onClick={() => setDenying(false)}>
              {t.approval.denyCancel}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="h-7 px-3 text-[11px]"
              disabled={busy}
              onClick={() => void respond({ decision: "deny", reason: reason.trim() || undefined })}
            >
              {t.approval.denyConfirm}
            </Button>
          </>
        ) : (
          <>
            <span className="mr-auto text-[10px] text-muted-foreground/70">{t.approval.enterHint}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
              disabled={busy}
              onClick={() => setDenying(true)}
            >
              <X className="h-3 w-3" />
              {t.approval.deny}
            </Button>
            <Button size="sm" className="h-7 px-3 text-[11px]" disabled={!canApprove} onClick={() => void approve()}>
              <Check className="h-3 w-3" />
              {t.approval.approve}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
