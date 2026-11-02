import { ArrowUp, FileText, Square } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { listWorkspaceFiles } from "../api";
import { matchFiles, mentionAt, type FileMatch } from "../file-mention";
import { useI18n } from "../i18n/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const MAX_OPTIONS = 8;

/** 固定在底部的输入框。运行中发送按钮变成停止按钮；toolbar 放模型、工作区等选项 */
export function Composer(props: {
  placeholder: string;
  running: boolean;
  disabled?: boolean;
  toolbar?: ReactNode;
  /** 可选的受控文本，比如点示例任务时由外部填入 */
  value?: string;
  onValueChange?: (text: string) => void;
  onSubmit: (text: string) => Promise<void>;
  onStop: () => void;
  /** 打开 @ 补全：列出这个工作区的文件；readPaths 是 agent 在这个会话里读过的文件 */
  mention?: { workspace: string; readPaths?: Set<string> };
  /** 外部（拖入文件后）在光标处插入文字 */
  insertRef?: MutableRefObject<((s: string) => void) | null>;
}) {
  const { t } = useI18n();
  const [inner, setInner] = useState("");
  const text = props.value ?? inner;
  const setText = props.onValueChange ?? setInner;
  const [busy, setBusy] = useState(false);
  const canSend = !props.disabled && !props.running && !busy && text.trim() !== "";
  const area = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const nextCaret = useRef<number | null>(null);

  // ---- @ 补全 ----
  const [files, setFiles] = useState<string[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const token = props.mention ? mentionAt(text, caret) : undefined;
  const open = token !== undefined && token.start !== dismissedAt;
  const matches = open && files ? matchFiles(files, token.query) : [];
  const shown = matches.slice(0, MAX_OPTIONS);

  // 每次新开一个 @ 都重新列一遍文件：工作区可能刚被 agent 或拖拽改过
  const openAt = open ? token.start : null;
  useEffect(() => {
    if (openAt === null || !props.mention) return;
    let cancelled = false;
    setFiles(null);
    setListError(null);
    listWorkspaceFiles(props.mention.workspace)
      .then((r) => !cancelled && setFiles(r.files))
      .catch((err) => {
        if (cancelled) return;
        setFiles([]);
        setListError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [openAt, props.mention?.workspace]);

  useEffect(() => setActive(0), [token?.query, openAt]);

  // 改完文字后把光标放回该在的位置
  useLayoutEffect(() => {
    if (nextCaret.current === null || !area.current) return;
    area.current.setSelectionRange(nextCaret.current, nextCaret.current);
    setCaret(nextCaret.current);
    nextCaret.current = null;
  });

  const replace = (from: number, to: number, insert: string) => {
    setText(text.slice(0, from) + insert + text.slice(to));
    nextCaret.current = from + insert.length;
    area.current?.focus();
  };

  const pick = (m: FileMatch) => replace(token!.start, caret, `@${m.path} `);

  if (props.insertRef) {
    props.insertRef.current = (s: string) => {
      const before = text.slice(0, caret);
      const pad = before === "" || /\s$/.test(before) ? "" : " ";
      replace(caret, caret, `${pad}${s} `);
    };
  }

  const submit = async () => {
    if (!canSend) return;
    setBusy(true);
    try {
      await props.onSubmit(text.trim());
      setText("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative rounded-[24px] border border-border bg-input-surface px-2.5 pt-2.5 pb-2 shadow-sm transition-colors focus-within:border-ring/30">
      {open && (
        <MentionList
          files={files}
          error={listError}
          query={token.query}
          options={shown}
          more={matches.length - shown.length}
          active={active}
          readPaths={props.mention?.readPaths}
          onPick={pick}
          onHover={setActive}
        />
      )}
      <Textarea
        ref={area}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setCaret(e.target.selectionStart);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          // 输入法组字时按键交给输入法
          if (e.nativeEvent.isComposing) return;
          if (open) {
            if (e.key === "Escape") {
              e.preventDefault();
              setDismissedAt(token.start);
              return;
            }
            if (shown.length > 0) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const step = e.key === "ArrowDown" ? 1 : -1;
                setActive((i) => (i + step + shown.length) % shown.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pick(shown[active] ?? shown[0]!);
                return;
              }
            }
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder={props.placeholder}
        disabled={props.disabled}
        rows={1}
        className="max-h-60 min-h-[44px] resize-none border-0 bg-transparent px-2.5 py-1.5 text-[15px] shadow-none [field-sizing:content] hover:border-0 focus-visible:bg-transparent focus-visible:ring-0 md:text-[15px]"
      />
      <div className="mt-1 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">{props.toolbar}</div>
        <Button
          size="icon"
          variant={props.running ? "secondary" : "default"}
          className="h-9 w-9 rounded-full"
          onClick={props.running ? props.onStop : () => void submit()}
          disabled={!props.running && !canSend}
          aria-label={props.running ? t.stop : t.send}
          title={props.running ? t.stop : t.send}
        >
          {/* 发送和停止共用一个按钮，图标交叉淡入，颜色跟着 variant 过渡 */}
          <span key={props.running ? "stop" : "send"} className="animate-in fade-in zoom-in-95 duration-150 ease-smooth">
            {props.running ? <Square className="!size-3.5 fill-current" /> : <ArrowUp />}
          </span>
        </Button>
      </div>
    </div>
  );
}

/** 贴在输入框正上方、同宽的文件列表 */
function MentionList(props: {
  files: string[] | null;
  error: string | null;
  query: string;
  options: FileMatch[];
  more: number;
  active: number;
  readPaths?: Set<string>;
  onPick: (m: FileMatch) => void;
  onHover: (i: number) => void;
}) {
  const { t } = useI18n();
  const Key = ({ k, label }: { k: string; label: string }) => (
    <span>
      <kbd className="mr-1 rounded border border-border px-1 font-sans text-[11px]">{k}</kbd>
      {label}
    </span>
  );
  const empty = props.error
    ? `${t.files.listFailed} ${props.error}`
    : props.files === null
      ? t.files.loading
      : props.files.length === 0
        ? t.files.empty
        : t.files.none(props.query);

  return (
    <div className="absolute inset-x-0 bottom-[calc(100%+8px)] z-20 rounded-[14px] border border-border bg-popover p-1.5 shadow-lg animate-in fade-in slide-in-from-bottom-1 duration-150 ease-smooth">
      {props.options.length === 0 ? (
        <div className="px-2.5 py-2 text-[13px] text-muted-foreground">{empty}</div>
      ) : (
        <>
          <div className="flex items-center px-2.5 pt-1 pb-1.5 text-xs text-muted-foreground">
            {t.files.header}
            <span className="ml-auto flex gap-2.5">
              <Key k="↑↓" label={t.files.keySelect} />
              <Key k="Enter" label={t.files.keyInsert} />
              <Key k="Esc" label={t.files.keyClose} />
            </span>
          </div>
          {props.options.map((m, i) => (
            <button
              key={m.path}
              type="button"
              // 按下就选，不让输入框先失焦
              onMouseDown={(e) => {
                e.preventDefault();
                props.onPick(m);
              }}
              onMouseEnter={() => props.onHover(i)}
              // 深色主题下 accent 和弹窗底色几乎一样，选中行改用前景色的半透明底
              className={cn("flex h-[34px] w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm", i === props.active && "bg-foreground/[0.08]")}
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="shrink-0">
                {m.at >= 0 && props.query ? (
                  <>
                    {m.name.slice(0, m.at)}
                    <b className="font-semibold">{m.name.slice(m.at, m.at + props.query.length)}</b>
                    {m.name.slice(m.at + props.query.length)}
                  </>
                ) : (
                  m.name
                )}
              </span>
              <span className="min-w-0 truncate text-[13px] text-muted-foreground">{m.dir}</span>
              {props.readPaths?.has(m.path) && (
                <span className="ml-auto shrink-0 text-xs text-muted-foreground" title={t.files.readHint}>
                  {t.files.read}
                </span>
              )}
            </button>
          ))}
          {props.more > 0 && <div className="mt-1 border-t border-border px-2.5 pt-1.5 pb-0.5 text-xs text-muted-foreground">{t.files.more(props.more)}</div>}
        </>
      )}
    </div>
  );
}
