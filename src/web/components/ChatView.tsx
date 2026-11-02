import { Cpu, FolderOpen, History, PanelRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SeamEvent } from "../../events";
import { readCoverage } from "../../insight";
import { reconstruct } from "../../replay";
import { respondApproval, sendMessage, startTask, stopSession, subscribe, type ApprovalRequest, type Config } from "../api";
import { useI18n } from "../i18n/i18n";
import { eventsAtStep, replaySteps } from "../replay-steps";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { DropZone, useAddedFiles } from "./AddedFiles";
import { ApprovalBanner } from "./ApprovalBanner";
import { Composer } from "./Composer";
import { IconButton } from "./IconButton";
import { ModelPicker } from "./ModelPicker";
import type { PanelSession } from "./RawPanel";
import { initialModelChoice, loadModelChoice, saveModelChoice } from "../model-choice";
import { ReplayBar } from "./ReplayBar";
import { StatusBadge } from "./StatusBadge";
import { Turn } from "./Turn";
import { basename, WorkspacePicker } from "./WorkspacePicker";

interface ViewProps {
  rawOpen: boolean;
  onToggleRaw: () => void;
  onRaw: (value: unknown) => void;
}

/** 新会话：空白对话页 + 底部输入框，输入框工具栏里选模型和工作区 */
export function NewChat({ config, onCreated, ...view }: ViewProps & { config: Config; onCreated: (id: string) => void }) {
  const { t, lang } = useI18n();
  const [choice, setChoice] = useState(() => initialModelChoice(config.providers, loadModelChoice()));
  const [workspace, setWorkspace] = useState(config.defaultWorkspace);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // 每次打开新会话页随机选一条提示；切换语言时保持同一条
  const [tipIndex] = useState(() => Math.floor(Math.random() * t.tips.length));
  const insertRef = useRef<((s: string) => void) | null>(null);
  const files = useAddedFiles(workspace, (s) => insertRef.current?.(s));

  return (
    <div className="flex min-w-0 flex-1 flex-col animate-in fade-in duration-150 ease-smooth">
      <Header title="" {...view} />
      <DropZone disabled={!workspace} onDrop={(f, d) => void files.drop(f, d)}>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-[12vh]">
          <div className="w-full max-w-[740px]">
            <h1 className="mb-7 text-center text-[28px] font-medium tracking-tight">{t.welcomeTitle}</h1>
            {config.providers.length === 0 && <p className="mb-3 text-center text-sm text-destructive">{t.noProviders}</p>}
            {files.notice}
            <Composer
              mention={{ workspace }}
              insertRef={insertRef}
              placeholder={t.composerPlaceholder}
              value={draft}
              onValueChange={setDraft}
              running={false}
              disabled={!choice}
              onStop={() => undefined}
              onSubmit={async (task) => {
                setError(null);
                try {
                  const { sessionId } = await startTask({ task, provider: choice!.provider, model: choice!.model, workspace, lang, files: files.added });
                  files.clear();
                  onCreated(sessionId);
                } catch (err) {
                  setError(`${t.errors.start} ${(err as Error).message}`);
                  throw err;
                }
              }}
              toolbar={
                <>
                  <ModelPicker
                    providers={config.providers}
                    value={choice}
                    onChange={(c) => {
                      setChoice(c);
                      saveModelChoice(c);
                    }}
                  />
                  <WorkspacePicker
                    value={workspace}
                    onChange={(path) => {
                      setError(null);
                      setWorkspace(path);
                      // 拖进来的文件属于原来的工作区，换了工作区就不再算这次添加的
                      files.clear();
                    }}
                    canPickFolder={config.canPickFolder}
                    onError={setError}
                  />
                </>
              }
            />
            {/* 一句随机的小提示 + 确认规则；出错时换成错误信息 */}
            <p className={`mt-2.5 text-center text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}>
              {error ?? `${t.tips[tipIndex]} ${t.readOnlyHint}`}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {t.examples.map((example) => (
                <button
                  key={example}
                  onClick={() => setDraft(example)}
                  className="rounded-full border border-border px-3.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        </div>
      </DropZone>
    </div>
  );
}

/** 已有会话：实时显示、继续追问、回放 */
export function SessionChat({
  sessionId,
  onActivity,
  onEvents,
  ...view
}: ViewProps & { sessionId: string; onActivity: () => void; onEvents: (s: PanelSession) => void }) {
  const { t } = useI18n();
  const [events, setEvents] = useState<SeamEvent[]>([]);
  const [deltas, setDeltas] = useState<Record<number, string>>({});
  const [running, setRunning] = useState(false);
  const [replayStep, setReplayStep] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<Record<string, ApprovalRequest>>({});
  // 服务端补发完历史事件后才会发第一条 status；在此之前收到的回合都算历史，不播入场动画
  const [animateFrom, setAnimateFrom] = useState<number | null>(null);
  const lastSeq = useRef(0);
  const turnCount = useRef(0);
  const insertRef = useRef<((s: string) => void) | null>(null);

  useEffect(
    () =>
      subscribe(sessionId, (m) => {
        if (m.kind === "event") {
          // 重连时服务端会从头补发事件，按序号去重
          if (m.event.seq <= lastSeq.current) return;
          lastSeq.current = m.event.seq;
          if (m.event.type === "turn_start") turnCount.current += 1;
          if (m.event.type === "permission") {
            // 某个请求已经有决定了，顺手收掉可能残留的确认卡
            const toolCallId = m.event.data.toolCallId;
            setApprovals((prev) => {
              if (!(toolCallId in prev)) return prev;
              const next = { ...prev };
              delete next[toolCallId];
              return next;
            });
          }
          setEvents((prev) => [...prev, m.event]);
        } else if (m.kind === "delta") setDeltas((prev) => ({ ...prev, [m.turn]: (prev[m.turn] ?? "") + m.text }));
        else if (m.kind === "approval") {
          setApprovals((prev) => ({ ...prev, [m.request.toolCallId]: m.request }));
        } else if (m.kind === "approval_resolved") {
          setApprovals((prev) => {
            const next = { ...prev };
            delete next[m.toolCallId];
            return next;
          });
        } else {
          setAnimateFrom((v) => v ?? turnCount.current);
          setRunning(m.running);
          // 运行结束后不应该还有挂起的确认；清掉重连时可能残留的旧卡片
          if (!m.running) setApprovals({});
          onActivity();
        }
      }),
    [sessionId, onActivity],
  );

  const steps = useMemo(() => replaySteps(events), [events]);
  const replaying = replayStep !== null;
  const visible = useMemo(
    () => (replaying ? eventsAtStep(events, steps, replayStep) : events),
    [events, steps, replayStep, replaying],
  );
  const session = useMemo(() => reconstruct(visible), [visible]);
  // 侧边面板跟着回放走：任务地图和阅读覆盖只显示到当前这一步
  useEffect(() => onEvents({ sessionId, events: visible }), [sessionId, visible, onEvents]);
  const full = useMemo(() => reconstruct(events), [events]);
  const start = full.start;
  const pendingApprovals = Object.values(approvals);
  const waiting = pendingApprovals.length > 0;
  const status = waiting ? "waiting" : running ? "running" : (full.end?.reason ?? "unknown");
  const files = useAddedFiles(start?.workspace, (s) => insertRef.current?.(s));
  // @ 列表里标出 agent 在这个会话里读过的文件
  const readPaths = useMemo(() => new Set(Object.keys(readCoverage(events).files)), [events]);

  if (!start) return <div className="flex-1" />;

  const toggleReplay = () => setReplayStep(replaying ? null : 0);

  return (
    <div className="flex min-w-0 flex-1 flex-col animate-in fade-in duration-150 ease-smooth">
      <Header
        title={start.task}
        // 完成是默认状态，不标
        meta={status !== "completed" && <StatusBadge status={status} />}
        actions={
          <IconButton label={replaying ? t.replay.exit : t.replay.toggle} active={replaying} onClick={toggleReplay} disabled={running || steps.length === 0}>
            <History />
          </IconButton>
        }
        {...view}
      />

      <DropZone disabled={replaying || waiting} onDrop={(f, d) => void files.drop(f, d)}>
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="mx-auto w-full max-w-[740px] gap-7 px-6 pt-4 pb-10">
            {session.turns.map((turn, index) => (
              <Turn
                key={turn.turn}
                turn={turn}
                animate={!replaying && animateFrom !== null && index >= animateFrom}
                streaming={replaying || turn.assistant ? undefined : deltas[turn.turn]}
                approvals={approvals}
                onRaw={view.onRaw}
              />
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="mx-auto w-full max-w-[740px] px-6 pb-4">
          {/* 等待确认时横幅替代输入框：这时既不能追问，停止也放在横幅里 */}
          {pendingApprovals[0] ? (
            <ApprovalBanner
              key={pendingApprovals[0].toolCallId}
              request={pendingApprovals[0]}
              count={pendingApprovals.length}
              onRespond={async (body) => {
                await respondApproval(sessionId, pendingApprovals[0]!.toolCallId, body);
              }}
              onStop={() => void stopSession(sessionId).catch(() => undefined)}
            />
          ) : replaying ? (
            <ReplayBar steps={steps.length} step={replayStep} onStep={setReplayStep} />
          ) : (
            <>
              {files.notice}
              <Composer
                mention={{ workspace: start.workspace, readPaths }}
                insertRef={insertRef}
                placeholder={t.followUpPlaceholder}
                running={running}
                onStop={() => void stopSession(sessionId).catch(() => undefined)}
                onSubmit={async (text) => {
                  setError(null);
                  try {
                    await sendMessage(sessionId, text, files.added);
                    files.clear();
                  } catch (err) {
                    setError(`${t.errors.send} ${(err as Error).message}`);
                    throw err;
                  }
                }}
                // 和新会话页放在同一个位置；会话开始后不能再换，所以只显示、不带下拉
                toolbar={
                  <>
                    <span className="flex h-8 shrink-0 items-center gap-1.5 px-2.5 text-[13px] text-muted-foreground" title={`${start.model.provider}/${start.model.id}`}>
                      <Cpu className="size-3.5" />
                      {start.model.id}
                    </span>
                    <span className="flex h-8 min-w-0 items-center gap-1.5 px-2.5 text-[13px] text-muted-foreground" title={start.workspace}>
                      <FolderOpen className="size-3.5 shrink-0" />
                      <span className="truncate">{basename(start.workspace)}</span>
                    </span>
                  </>
                }
              />
              {error && <p className="mt-2 text-center text-xs text-destructive">{error}</p>}
            </>
          )}
        </div>
      </DropZone>
    </div>
  );
}

function Header(props: ViewProps & { title: string; meta?: React.ReactNode; actions?: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <header className="flex h-13 shrink-0 items-center gap-1 px-4">
      <div className="flex min-w-0 flex-1 items-baseline gap-3 whitespace-nowrap">
        <div className="min-w-0 truncate text-[15px] font-medium">{props.title}</div>
        {props.meta && <div className="flex min-w-0 shrink items-center gap-3 text-xs text-muted-foreground">{props.meta}</div>}
      </div>
      {props.actions}
      <IconButton label={t.raw.toggle} active={props.rawOpen} onClick={props.onToggleRaw}>
        <PanelRight />
      </IconButton>
    </header>
  );
}
