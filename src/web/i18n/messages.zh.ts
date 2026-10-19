import type { Messages } from "./messages.en";

export const zh: Messages = {
  appName: "Seam",
  newTask: "新任务",
  sessions: "会话",
  noSessions: "还没有会话。",
  language: "English",
  selectSession: "在左侧选择一个会话，或者开始一个新任务。",

  task: "任务",
  taskPlaceholder: "描述你希望 agent 在这个文件夹里做什么……",
  provider: "模型供应商",
  noProviders: "没有找到 API Key。请设置 ANTHROPIC_API_KEY 或 DEEPSEEK_API_KEY，然后重启 Seam。",
  workspace: "工作区文件夹",
  workspaceHint: "agent 只能读取这个文件夹里的内容。写文件和执行命令暂不可用。",
  start: "开始",
  starting: "正在启动……",
  stop: "停止",

  status: {
    running: "运行中",
    completed: "已完成",
    error: "出错",
    aborted: "已停止",
    max_turns: "达到轮数上限",
    unknown: "未知",
  },

  turn: (n) => `第 ${n} 轮`,
  request: (messages, tools) => `已发送请求：${messages} 条消息，${tools} 个工具`,
  viewRaw: "原始内容",
  streaming: "正在输出……",
  tokens: (input, output) => `输入 ${input} 个 token · 输出 ${output} 个`,

  modelSays: "模型说：",
  intentMissing: "（模型没有给出理由）",
  permission: {
    allowAuto: "自动放行",
    allowUser: "你已批准",
    deny: "已拒绝",
  },
  result: "结果：",
  resultError: "出错：",
  answer: "回答",
  end: (status, seconds) => `${status}，用时 ${seconds} 秒`,

  source: {
    harness: "由 harness 记录",
    model: "模型自述",
    user: "你",
  },

  replay: {
    label: "回放",
    step: (i, n) => `第 ${i} 步，共 ${n} 步`,
    first: "第一步",
    prev: "上一步",
    next: "下一步",
    last: "最后一步",
  },

  raw: {
    title: "原始记录",
    close: "关闭",
  },

  errors: {
    load: "无法加载这个会话。",
    start: "无法启动任务。",
  },
};
