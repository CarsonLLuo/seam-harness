import { useState } from "react";
import { startTask, type Config } from "../api";
import { useI18n } from "../i18n/i18n";

export function NewTask({ config, onStarted }: { config: Config; onStarted: (id: string) => void }) {
  const { t, lang } = useI18n();
  const [task, setTask] = useState("");
  const [provider, setProvider] = useState(config.providers[0] ?? "");
  const [workspace, setWorkspace] = useState(config.defaultWorkspace);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { sessionId } = await startTask({ task, provider, workspace, lang });
      onStarted(sessionId);
    } catch (err) {
      setError(`${t.errors.start} ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const label = "mb-1.5 block text-sm font-medium";
  const input =
    "w-full rounded-md border border-border bg-card px-3 py-2 text-[15px] outline-none focus:border-foreground/40";

  return (
    <div className="mx-auto max-w-2xl px-8 py-12">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight">{t.newTask}</h1>

      {config.providers.length === 0 && (
        <p className="mb-6 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">{t.noProviders}</p>
      )}

      <label className={label} htmlFor="task">
        {t.task}
      </label>
      <textarea
        id="task"
        value={task}
        onChange={(e) => setTask(e.target.value)}
        placeholder={t.taskPlaceholder}
        rows={4}
        className={`${input} resize-y leading-relaxed`}
      />

      <div className="mt-5 grid grid-cols-[180px_1fr] gap-4">
        <div>
          <label className={label} htmlFor="provider">
            {t.provider}
          </label>
          <select id="provider" value={provider} onChange={(e) => setProvider(e.target.value)} className={input}>
            {config.providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="workspace">
            {t.workspace}
          </label>
          <input
            id="workspace"
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
            className={`${input} font-mono text-sm`}
          />
        </div>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{t.workspaceHint}</p>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      <button
        onClick={submit}
        disabled={busy || !task.trim() || !provider}
        className="mt-6 rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-40"
      >
        {busy ? t.starting : t.start}
      </button>
    </div>
  );
}
