// 界面上的所有文字都在这里，组件里不直接写字符串。中文版见 messages.zh.ts，两边的 key 必须一致。
export const en = {
  appName: "Seam",
  newSession: "New session",
  language: "中文",
  languageHint: "Switch to Chinese",
  noSessions: "No sessions yet.",
  collapseSidebar: "Collapse sidebar",
  expandSidebar: "Expand sidebar",
  theme: {
    label: "Theme",
    system: "System",
    light: "Light",
    dark: "Dark",
  },
  groups: {
    today: "Today",
    yesterday: "Yesterday",
    week: "Previous 7 days",
    older: "Older",
  },

  welcomeTitle: "What should the agent do?",
  welcomeHint: "Seam shows what the agent actually reads, what it asks to do, and what is only its own account.",
  composerPlaceholder: "Describe a task for this folder…",
  followUpPlaceholder: "Ask a follow-up…",
  replayingPlaceholder: "Turn off replay to send a message.",
  send: "Send",
  stop: "Stop",
  provider: "Model provider",
  model: "Model",
  workspace: "Workspace folder",
  recentWorkspaces: "Recent folders",
  chooseFolder: "Choose folder…",
  typePath: "Type a path…",
  noProviders: "No API key found. Add one to .env and restart Seam.",
  readOnlyHint: "Writing files and running commands ask for your approval.",
  tipLabel: "Tip",
  /** 空白页随机显示一条：每条纠正一个关于 agent 的常见误解 */
  tips: [
    "The agent only knows what it has actually read. Files it never opened are invisible to it.",
    "Text next to the purple dashed line is the model's own account. It is not necessarily the real reason it acted.",
    "The model has no memory of its own: every turn, the harness sends the earlier conversation to it again.",
    "The model can only ask to read files or run commands. The harness is what carries them out and decides what is allowed.",
    "Click “N messages sent” on a turn to see everything that was actually sent to the model.",
    "Replay lets you step through a session to see at which point the agent made each decision.",
    "Some of what is sent to the model was not written by you: the harness adds content to every request.",
  ],
  examplesLabel: "Try one of these",
  examples: [
    "Find all exported functions that have no tests, and list them with their files.",
    "Summarize what each file in this folder is for.",
    "List the dependencies this project uses and explain what each one does.",
  ],

  status: {
    running: "Running",
    waiting: "Waiting for you",
    completed: "Completed",
    error: "Error",
    aborted: "Stopped",
    max_turns: "Turn limit reached",
    unknown: "Unknown",
  },

  turn: (n: number) => `Turn ${n}`,
  request: (messages: number, tools: number) => `${messages} messages · ${tools} tools sent`,
  thinking: "Waiting for the model…",
  tokens: (input: number, output: number) => `${input} tokens in · ${output} out`,
  runEnded: (status: string, seconds: string) => `${status} · ${seconds} s`,

  modelSays: "The model says:",
  intentMissing: "(the model gave no reason)",
  permission: {
    allowAuto: "Allowed automatically",
    allowUser: "Approved by you",
    deny: "Denied",
    pending: "Waiting for the harness",
    waitingUser: "Waiting for your decision",
    byTimeout: "Denied after 10 minutes with no response",
    byAborted: "Stopped before you answered",
    boundary: "Blocked by the harness",
    planRequired: "A plan is required first",
    planDenied: "Plan denied",
    notExecuted: "Not executed",
    outsideWorkspace: (path: string) =>
      `Blocked by the harness: “${path}” is outside this workspace, so the agent cannot access it.`,
    planRequiredHint:
      "The harness requires a plan before the agent writes files or runs commands. It has been told to propose one first.",
    notExecutedHint: "The service restarted while this call was pending, so it never ran.",
  },
  approval: {
    title: "The model's request",
    paused: "Paused by the harness",
    gate: "This is the model's request. The harness stopped it and is handing the decision to you.",
    approve: "Approve",
    deny: "Deny",
    denyReason: "Reason for denying (optional, passed to the model)",
    writeCreate: "Create file",
    writeOverwrite: "Overwrite file",
    lines: (added: number, removed: number) => `+${added} / −${removed} lines`,
    commandWarning: "Commands run with your permissions and can reach outside the workspace.",
    planHint: "Edit, remove, or add steps. The model will follow the plan you approve.",
    addStep: "Add step",
    removeStep: "Remove this step",
    stepLabel: (n: number) => `Step ${n}`,
  },
  plan: {
    stepCount: (n: number) => `${n} steps`,
  },
  result: "Result",
  resultError: "Error",
  viewRaw: "View raw record",

  source: {
    harness: "Recorded by the harness",
    model: "The model's own account",
    user: "You",
  },

  replay: {
    toggle: "Replay",
    exit: "Exit replay",
    step: (i: number, n: number) => `Step ${i} of ${n}`,
    first: "First step",
    prev: "Previous step",
    next: "Next step",
    last: "Last step",
  },

  raw: {
    toggle: "Raw records",
    title: "Raw record",
    close: "Close",
    empty: "Click “View raw record” on a turn or tool call to see exactly what was sent or returned.",
  },

  unauthorized: {
    title: "Seam needs a new access link",
    body: "The access token in this browser no longer matches the running Seam, usually because Seam was restarted. Open the link printed in the terminal again.",
  },

  errors: {
    start: "Could not start the task.",
    send: "Could not send the message.",
    pickFolder: "Could not open the folder picker.",
  },
};

export type Messages = typeof en;
