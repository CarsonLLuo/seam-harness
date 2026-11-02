import {
  ChevronRight,
  FilePen,
  FileText,
  ListChecks,
  Loader2,
  Search,
  SquareTerminal,
  User,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { KEY_ARG } from "../../insight";
import type { ReplayToolCall, ReplayTurn } from "../../replay";
import type { AddedFiles, ApprovalRequest } from "../api";
import { splitMentions } from "../file-mention";
import { useI18n } from "../i18n/i18n";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

type Raw = (value: unknown) => void;

const TOOL_ICONS: Record<string, LucideIcon> = {
  read_file: FileText,
  write_file: FilePen,
  search: Search,
  run_command: SquareTerminal,
  propose_plan: ListChecks,
};

function textOf(content: unknown[] | undefined): string {
  return (content ?? [])
    .filter((c: any) => c?.type === "text")
    .map((c: any) => c.text as string)
    .join("\n")
    .trim();
}

/** 消息里的 @path 用等宽字和浅底标出来；只是显示，不展开文件内容 */
export function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[78%] rounded-[20px] bg-secondary px-4 py-2.5 text-[15px] leading-[1.6] whitespace-pre-wrap">
        {splitMentions(text).map((p, i) =>
          p.mention ? (
            <span key={i} className="rounded-[5px] bg-foreground/[0.07] px-1 py-px font-mono text-[0.86em] break-all">
              {p.text}
            </span>
          ) : (
            p.text
          ),
        )}
      </div>
    </div>
  );
}

/** harness 事实：这些文件是用户自己放进工作区的，不是 agent 写的 */
function FilesAdded({ files }: { files: AddedFiles }) {
  const { t } = useI18n();
  const dirs = new Set(files.map((f) => f.path.slice(0, f.path.lastIndexOf("/") + 1)));
  // 拖进来的文件都在 uploads/，按设计稿只写一次目录；万一不在同一个目录就写完整路径
  const [dir] = dirs;
  const text =
    dirs.size === 1 && dir
      ? t.files.added(files.length, dir, files.map((f) => f.path.slice(dir.length)).join(t.listSeparator))
      : t.files.added(files.length, t.files.workspace, files.map((f) => f.path).join(t.listSeparator));
  return (
    <div className="flex items-start justify-end gap-2 text-[13.5px] text-muted-foreground">
      <User className="mt-[3px] size-4 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

export function MarkdownText({ text }: { text: string }) {
  return (
    <div className="prose prose-neutral max-w-none text-[15px] leading-[1.65] dark:prose-invert prose-p:my-2 prose-pre:bg-code-bg prose-pre:text-xs [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:text-sm [&_:not(pre)>code]:font-normal prose-code:before:content-none prose-code:after:content-none prose-table:text-sm">
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
  );
}

export function Turn({
  turn,
  streaming,
  animate,
  approvals,
  onRaw,
}: {
  turn: ReplayTurn;
  streaming?: string;
  /** 只在运行过程中新出现的回合入场时播放动画，打开历史会话时不重播 */
  animate?: boolean;
  approvals?: Record<string, ApprovalRequest>;
  onRaw: Raw;
}) {
  const { t } = useI18n();
  const request = turn.requests.at(-1);
  const body = request?.body as { messages?: unknown[]; tools?: unknown[] } | undefined;
  const text = turn.assistant ? textOf(turn.assistant.content) : streaming;
  const usage = turn.assistant?.usage as
    | { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
    | undefined;
  const input = usage ? (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0) : undefined;
  // 用户停止时 pi 会留下 “The operation was aborted.” 之类的报错；这是停止的结果，不当成错误标红（原始记录里仍可看到）
  const stopped = turn.end?.reason === "aborted";
  const userText = turn.user ? (typeof turn.user.content === "string" ? turn.user.content : textOf(turn.user.content as unknown[])) : "";

  return (
    <div className={cn("space-y-3", animate && "animate-in fade-in slide-in-from-bottom-1 duration-150 ease-smooth")}>
      {turn.filesAdded && turn.filesAdded.length > 0 && <FilesAdded files={turn.filesAdded} />}
      {userText && <UserMessage text={userText} />}

      <div className="group/turn">
        {/* 轮次标题：harness 记录的事实，可打开原始请求 */}
        <div className="mb-1.5 flex min-w-0 items-center gap-2 text-xs whitespace-nowrap text-muted-foreground">
          <span className="shrink-0 font-medium">{t.turn(turn.turn)}</span>
          {request && (
            <button
              onClick={() => onRaw(request)}
              className="min-w-0 truncate rounded px-1 opacity-0 transition-opacity group-focus-within/turn:opacity-100 group-hover/turn:opacity-100 hover:bg-accent/70 hover:text-foreground"
            >
              {t.request(body?.messages?.length ?? 0, body?.tools?.length ?? 0)}
            </button>
          )}
          {usage && input !== undefined && <span className="tabular-nums opacity-0 transition-opacity group-hover/turn:opacity-100">{t.tokens(input, usage.output ?? 0)}</span>}
        </div>

        {text ? (
          // 模型写的文字（包括最终回答）都是模型自述，用一个小标签标出来。
          // 紫色虚线只留给工具调用里的「模型说」：那里自述和 harness 事实挨在一起，才需要区分
          <div title={t.source.model}>
            <div className="text-xs font-medium text-self-report">{t.source.model}</div>
            <MarkdownText text={text} />
          </div>
        ) : (
          !turn.assistant &&
          turn.toolCalls.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t.thinking}
            </div>
          )
        )}
        {turn.assistant?.errorMessage && !stopped && <p className="mt-2 text-sm text-destructive">{turn.assistant.errorMessage}</p>}

        {turn.toolCalls.length > 0 && (
          <div className={cn("space-y-1", text && "mt-3")}>
            {turn.toolCalls.map((c) => (
              <ToolCallRow
                key={c.call.toolCallId}
                call={c}
                animate={animate}
                approval={approvals?.[c.call.toolCallId]}
                onRaw={onRaw}
              />
            ))}
          </div>
        )}

        {turn.end && (
          // 正常完成的耗时只在悬停时显示；停止、出错等结果始终可见
          <div
            className={cn(
              "mt-3 text-xs text-muted-foreground tabular-nums",
              turn.end.reason === "completed" && "opacity-0 transition-opacity group-focus-within/turn:opacity-100 group-hover/turn:opacity-100",
            )}
          >
            {t.runEnded(t.status[turn.end.reason], (turn.end.durationMs / 1000).toFixed(1))}
            {turn.end.errorMessage && !stopped && <span className="text-destructive"> — {turn.end.errorMessage}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolCallRow({
  call,
  animate,
  approval,
  onRaw,
}: {
  call: ReplayToolCall;
  animate?: boolean;
  approval?: ApprovalRequest;
  onRaw: Raw;
}) {
  const { t } = useI18n();
  const { name, args } = call.call;
  const Icon = TOOL_ICONS[name] ?? Wrench;
  const planSteps = Array.isArray(args.steps) ? args.steps : undefined;
  const keyArg = planSteps ? t.plan.stepCount(planSteps.length) : args[KEY_ARG[name] ?? ""];
  const permission = call.permission;
  const result = call.result;
  const denied = permission?.decision === "deny";
  const resultText = result ? textOf(result.content) : "";

    const permissionLabel = !permission
    ? approval
      ? t.permission.waitingUser
      : t.permission.pending
    : denied
      ? permission.by === "timeout"
        ? t.permission.byTimeout
        : permission.by === "aborted"
          ? t.permission.byAborted
          : permission.code === "outside_workspace"
            ? t.permission.boundary
            : permission.code === "plan_required"
              ? t.permission.planRequired
              : permission.code === "plan_denied"
                ? t.permission.planDenied
                : permission.code === "not_executed"
                  ? t.permission.notExecuted
                  : t.permission.deny
      : permission.by === "auto"
        ? t.permission.allowAuto
        : t.permission.allowUser;

  return (
    <Collapsible className={cn(animate && "animate-in fade-in duration-150 ease-smooth")}>
      <CollapsibleTrigger className="group/row flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-accent/60">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/row:rotate-90" />
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        {/* 状态靠文字表达：进行中有微光扫过，完成后变成次要灰，只有被拒绝或出错才出现颜色 */}
        <span className={cn("font-medium", !result ? "text-shimmer" : "text-muted-foreground")}>{name}</span>
        {typeof keyArg === "string" && (
          <span className={cn("min-w-0 truncate text-muted-foreground", planSteps ? "text-sm" : "font-mono text-xs")}>{keyArg}</span>
        )}
        {result && (denied || result.isError) && <X className="ml-auto h-3.5 w-3.5 shrink-0 text-destructive" />}
      </CollapsibleTrigger>

      {/* 模型自述：左侧紫色虚线 + 专用颜色的标签，内容用次要灰，和工具名左对齐；始终可见 */}
      <div className="mr-2 mb-1 ml-[44px] border-l-2 border-dashed border-self-report/50 pl-2 text-sm text-muted-foreground" title={t.source.model}>
        <span className="font-medium text-self-report">{t.modelSays}</span>{" "}
        {typeof args.intent === "string" ? args.intent : t.intentMissing}
        {typeof args.step === "number" && args.step > 0 && <span> {t.stepTag(args.step)}</span>}
      </div>

      {/* 待确认的请求不在工具行里展开：它显示在对话底部、输入框上方 */}

      {/* harness 的拦截原因：不用展开就能看到 */}
      {permission?.code === "outside_workspace" && (
        <div className="mt-1 mr-2 mb-1 ml-[54px] rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs leading-relaxed text-destructive">
          {t.permission.outsideWorkspace(permission.path ?? "")}
        </div>
      )}
      {permission?.code === "plan_required" && (
        <div className="pr-2 pb-1 pl-[54px] text-xs leading-relaxed text-muted-foreground">{t.permission.planRequiredHint}</div>
      )}
      {permission?.code === "not_executed" && (
        <div className="pr-2 pb-1 pl-[54px] text-xs leading-relaxed text-muted-foreground">{t.permission.notExecutedHint}</div>
      )}

      {/* harness 记录的事实：展开后可见。高度动画放在外层，内边距放在内层，收起时高度才能真正归零 */}
      <CollapsibleContent
        className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down duration-200 ease-smooth"
        title={t.source.harness}
      >
        <div className="mt-1 mr-2 mb-1 ml-[54px] rounded-lg bg-muted/40 px-3 py-2 text-sm">
          <div className={cn(denied ? "text-destructive" : "text-foreground")}>
            {permissionLabel}
            {permission?.reason && <span className="text-muted-foreground"> — {permission.reason}</span>}
          </div>
          {result && !(denied && resultText === permission?.reason) && (
            <div className="mt-2">
              <div className={cn("mb-1 text-xs font-medium", result.isError ? "text-destructive" : "text-muted-foreground")}>
                {result.isError ? t.resultError : t.result}
              </div>
              <pre className="max-h-64 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">{resultText}</pre>
            </div>
          )}
          <button onClick={() => onRaw(call)} className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            {t.viewRaw}
          </button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
