import { ArrowUp, Square } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useI18n } from "../i18n/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

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
}) {
  const { t } = useI18n();
  const [inner, setInner] = useState("");
  const text = props.value ?? inner;
  const setText = props.onValueChange ?? setInner;
  const [busy, setBusy] = useState(false);
  const canSend = !props.disabled && !props.running && !busy && text.trim() !== "";

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
    <div className="rounded-2xl border border-border/80 bg-input-surface p-2 shadow-sm transition-colors focus-within:border-ring/40">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // 输入法组字时按回车不应发送
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder={props.placeholder}
        disabled={props.disabled}
        rows={1}
        className="max-h-60 min-h-[44px] resize-none border-0 bg-transparent px-2 py-1.5 text-[15px] shadow-none [field-sizing:content] hover:border-0 focus-visible:bg-transparent focus-visible:ring-0 md:text-[15px]"
      />
      <div className="mt-1 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">{props.toolbar}</div>
        {props.running ? (
          <Button size="icon" variant="secondary" className="h-8 w-8 rounded-full" onClick={props.onStop} aria-label={t.stop} title={t.stop}>
            <Square className="!size-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={() => void submit()}
            disabled={!canSend}
            aria-label={t.send}
            title={t.send}
          >
            <ArrowUp />
          </Button>
        )}
      </div>
    </div>
  );
}
