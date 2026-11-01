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
    <div className="rounded-[24px] border border-border bg-input-surface px-2.5 pt-2.5 pb-2 shadow-sm transition-colors focus-within:border-ring/30">
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
