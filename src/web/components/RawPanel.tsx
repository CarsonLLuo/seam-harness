import { useI18n } from "../i18n/i18n";

/** 右侧面板：显示选中记录的原始内容，比如真实发出的请求 */
export function RawPanel({ value, onClose }: { value: unknown; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <aside className="flex w-[440px] shrink-0 flex-col border-l border-border bg-sidebar">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-medium">{t.raw.title}</span>
        <button onClick={onClose} className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted">
          {t.raw.close}
        </button>
      </div>
      <pre className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
        {JSON.stringify(value, null, 2)}
      </pre>
    </aside>
  );
}
