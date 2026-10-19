// 界面上的所有文字都在这里，组件里不直接写字符串。中文版见 messages.zh.ts，两边的 key 必须一致。
export const en = {
  appName: "Seam",
  newTask: "New task",
  sessions: "Sessions",
  noSessions: "No sessions yet.",
  language: "中文",
  selectSession: "Pick a session on the left, or start a new task.",

  task: "Task",
  taskPlaceholder: "Describe what the agent should do in this folder…",
  provider: "Model provider",
  noProviders: "No API key found. Set ANTHROPIC_API_KEY or DEEPSEEK_API_KEY and restart Seam.",
  workspace: "Workspace folder",
  workspaceHint: "The agent can only read inside this folder. Writing files and running commands are not available yet.",
  start: "Start",
  starting: "Starting…",
  stop: "Stop",

  status: {
    running: "Running",
    completed: "Completed",
    error: "Error",
    aborted: "Stopped",
    max_turns: "Turn limit reached",
    unknown: "Unknown",
  },

  turn: (n: number) => `Turn ${n}`,
  request: (messages: number, tools: number) => `Request sent: ${messages} messages, ${tools} tools`,
  viewRaw: "Raw",
  streaming: "Writing…",
  tokens: (input: number, output: number) => `${input} tokens in · ${output} out`,

  modelSays: "The model says:",
  intentMissing: "(the model gave no reason)",
  permission: {
    allowAuto: "Allowed automatically",
    allowUser: "Approved by you",
    deny: "Denied",
  },
  result: "Result:",
  resultError: "Error:",
  answer: "Answer",
  end: (status: string, seconds: string) => `${status} in ${seconds} s`,

  source: {
    harness: "Recorded by the harness",
    model: "The model's own account",
    user: "You",
  },

  replay: {
    label: "Replay",
    step: (i: number, n: number) => `Step ${i} of ${n}`,
    first: "First step",
    prev: "Previous step",
    next: "Next step",
    last: "Last step",
  },

  raw: {
    title: "Raw record",
    close: "Close",
  },

  errors: {
    load: "Could not load this session.",
    start: "Could not start the task.",
  },
};

export type Messages = typeof en;
