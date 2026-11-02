import { CircleAlert, Check, FileDown, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { uploadFiles, type AddedFiles } from "../api";
import { useI18n } from "../i18n/i18n";
import { IconButton } from "./IconButton";

const MAX_BYTES = 1024 * 1024; // 和服务端的 MAX_UPLOAD_BYTES 一致；超过的不上传，直接提示
const NOTICE_MS = 4000;

type NoticeRow = { ok: true; path: string; clashedWith?: string } | { ok: false; name: string; why: string };

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * 拖进对话区的文件：复制到工作区的 uploads/，把路径插进输入框，并记下这次添加了哪些文件，
 * 发送时交给服务端写进日志（files_added）。
 */
export function useAddedFiles(workspace: string | undefined, insert: (text: string) => void) {
  const { t } = useI18n();
  const [added, setAdded] = useState<AddedFiles>([]);
  const [notice, setNotice] = useState<NoticeRow[] | null>(null);

  // 全部成功时几秒后自动收起；有失败的留着，等用户关
  useEffect(() => {
    if (!notice || notice.some((r) => !r.ok)) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  async function drop(files: File[], folders: string[]) {
    if (!workspace) return;
    const rows: NoticeRow[] = folders.map((name) => ({ ok: false, name, why: t.files.folder }));
    const small = files.filter((f) => f.size <= MAX_BYTES);
    for (const f of files) if (f.size > MAX_BYTES) rows.push({ ok: false, name: f.name, why: t.files.tooLarge(mb(f.size)) });
    if (small.length > 0) {
      try {
        const res = await uploadFiles(workspace, small);
        const ok = res.added.map((a) => ({ ok: true as const, path: a.path, clashedWith: a.clashedWith }));
        rows.unshift(...ok);
        for (const r of res.rejected) rows.push({ ok: false, name: r.name, why: r.code === "too_large" ? t.files.tooLarge(mb(r.bytes)) : t.files.notText });
        setAdded((prev) => [...prev, ...res.added.map(({ path, name, bytes }) => ({ path, name, bytes }))]);
        if (ok.length > 0) insert(ok.map((r) => `@${r.path}`).join(" "));
      } catch (err) {
        rows.push({ ok: false, name: small.map((f) => f.name).join(", "), why: `${t.files.failed} ${(err as Error).message}` });
      }
    }
    if (rows.length > 0) setNotice(rows);
  }

  return {
    added,
    /** 发送成功后清空：这些文件已经记进日志 */
    clear: () => setAdded([]),
    drop,
    notice: notice && <AddedNotice rows={notice} onClose={() => setNotice(null)} />,
  };
}

function AddedNotice({ rows, onClose }: { rows: NoticeRow[]; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div className="mb-2 rounded-xl border border-border bg-popover py-1.5 pr-1.5 pl-3.5 text-[13.5px] shadow-lg animate-in fade-in slide-in-from-bottom-1 duration-150 ease-smooth">
      {rows.map((r, i) => (
        <div key={i} className="flex min-h-[26px] items-center gap-2">
          {r.ok ? <Check className="size-4 shrink-0 text-muted-foreground" /> : <CircleAlert className="size-4 shrink-0 text-destructive" />}
          <span className="min-w-0 truncate font-mono text-xs">{r.ok ? r.path : r.name}</span>
          {r.ok ? (
            r.clashedWith && <span className="min-w-0 truncate text-muted-foreground">{t.files.renamed(r.clashedWith, r.path.split("/").pop()!)}</span>
          ) : (
            <span className="min-w-0 truncate text-destructive">{r.why}</span>
          )}
          {i === 0 && (
            <IconButton label={t.files.close} onClick={onClose} className="ml-auto size-7 shrink-0">
              <X />
            </IconButton>
          )}
        </div>
      ))}
    </div>
  );
}

/** 整个对话区都是落点：拖着文件进来时盖一层虚线框，说明会复制到哪里、接受什么 */
export function DropZone(props: { disabled?: boolean; onDrop: (files: File[], folders: string[]) => void; children: ReactNode }) {
  const { t } = useI18n();
  const [over, setOver] = useState(false);
  const depth = useRef(0); // 进出子元素也会触发 dragenter/dragleave，靠计数判断是否真的离开
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      onDragEnter={(e) => {
        if (props.disabled || !hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (props.disabled || !hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        if (!over) return;
        depth.current -= 1;
        if (depth.current <= 0) {
          depth.current = 0;
          setOver(false);
        }
      }}
      onDrop={(e) => {
        if (props.disabled || !hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const files: File[] = [];
        const folders: string[] = [];
        for (const item of Array.from(e.dataTransfer.items)) {
          if (item.kind !== "file") continue;
          const entry = item.webkitGetAsEntry?.();
          const file = item.getAsFile();
          if (entry?.isDirectory) folders.push(entry.name);
          else if (file) files.push(file);
        }
        props.onDrop(files, folders);
      }}
    >
      {props.children}
      {over && (
        <div className="pointer-events-none absolute inset-2.5 z-30 flex flex-col items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-muted-foreground/60 bg-background/85 text-center backdrop-blur-[2px] animate-in fade-in duration-100">
          <FileDown className="mb-1 size-7 text-muted-foreground" />
          <div className="text-base font-medium">
            {t.files.dropTitle} <span className="font-mono text-[0.9em]">uploads/</span>
          </div>
          <div className="text-[13.5px] text-muted-foreground">{t.files.dropHint}</div>
        </div>
      )}
    </div>
  );
}
