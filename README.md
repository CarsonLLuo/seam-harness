<div align="center">

# Seam

**A human-centered, explainable agent harness**

Small in features, deep in explanation. Seam helps people who have never heard the word "harness" understand, while they use an agent, what it is doing, why it is doing it, and where they can step in.

![status](https://img.shields.io/badge/status-v0_command--line-orange?style=flat-square)
![runtime](https://img.shields.io/badge/runtime-Bun-black?style=flat-square)
![agent loop](https://img.shields.io/badge/agent_loop-pi--agent--core-blue?style=flat-square)

[Core idea](#core-idea) · [How it works](#how-it-works) · [Roadmap](#roadmap)

English | [简体中文](./README.zh-CN.md)

</div>

---

> **Status: v0 is done** — a command-line agent with a complete event log. The explanation features described below are design goals for v1 and later.

## Why Seam?

Most agent products aim for a "seamless" experience: the agent loop, context assembly and tool execution all stay hidden behind the interface. That feels smooth, but it leaves users with the wrong mental model:

- They think the agent **remembers everything**. In fact the model has no memory; the harness resends the history every turn and trims it when it gets too long.
- They think it **has looked at the whole folder**. In fact it has only seen the few files that were read into its context.
- They think it **operates the computer itself**. In fact the model only makes requests; the harness carries them out and decides what is allowed.

A wrong mental model leads directly to two kinds of failure: **over-trusting** a conclusion drawn from only three files, and **having no idea why** something went wrong.

Observability tools such as Langfuse and LangSmith can show these details, but they are built for developers. Explanation design aimed at ordinary users, with the goal of building an accurate mental model, is still largely missing.

## Core idea

**Seam** comes from *seamful design* in HCI: instead of smoothing over every seam in a system, deliberately expose the ones that matter, so that users build an accurate understanding and a well-calibrated level of trust.

Seam keeps its core agent capabilities to a minimal subset and puts all of its differentiation into human-centered transparency and explainability. **A small feature surface with deep explanation**: that ratio is itself the design statement.

### Design principles

1. **Every feature corrects a misconception or opens a point of control.** If a feature cannot say what it corrects or what it opens, it does not get built.
2. **Separate facts from self-reports.** Objective facts recorded by the harness (what was called, what came back) and the reasons the model gives for itself use different visual styles; the latter are always labeled "model's own account".
3. **Progressive disclosure.** Every action can be expanded from a one-sentence story down to the raw request; only the simplest layer is shown by default.
4. **Traceable sources.** Every piece of context and every conclusion can be traced back to where it came from: the user, a local file, a web page, memory or a Skill.
5. **Own the loop.** Tools, system prompts and context assembly are all implemented in-house, and the complete request sent to the model on every turn is recorded so it can be shown exactly.
6. **Explanations must be actionable.** Once users understand something, they should be able to correct it or decide on it in the same place.

## Misconceptions Seam corrects

| Common misconception | What actually happens | What Seam does |
| --- | --- | --- |
| The agent is a black box: drop a task in, wait for a result | It works through a plan over several turns and may adjust each turn | Task map: shows the current step, completed steps and steps that left the plan, live |
| It has looked at my whole folder | It only sees what was read into its context | Reading coverage map: files it read light up, files it never read stay grey |
| The reason it gives is why it acted that way | A model's self-report does not necessarily reflect its actual decision process | Facts and self-reports are shown in different styles |
| Its conclusions must be well-founded | A conclusion may rest on incomplete reading | Conclusion tracing: every claim links to the exact source passage |
| It operates my computer itself | The model only requests; the harness executes and gatekeeps | Permission prompts say "this is the model's request, stopped by the harness and handed to you" |
| It remembers everything I said | The harness resends history each turn and trims it when too long | The agent's desk: context you can see and edit (v2) |
| Text on a web page cannot influence it | Web content enters the context just like user instructions | Source labels and injection warnings (v3) |

## How it works

Every event in Seam is written to a single event log. The explanation layer generates all of its explanations from that log alone, so the facts shown in the interface always match what actually ran.

```
UI layer (local web)       ← renders explanations; approvals and interventions go back
     ▲                       to the permission gate and the next turn's context
Explanation layer          ← builds story sentences, coverage map, conclusion tracing;
     ▲                       labels model self-reports
Event log (JSONL)          ← full request, response, tool results, timing, tokens per turn
     ▲
Core harness               ← agent loop + in-house tools, permission gate, workspace boundary
```

For example, when the agent reads a PDF, the interface shows just one line by default:

> Read pages 1–5 of `report.pdf` (12 pages in total)
> *The model says: checking the sample size in the third paper*

The first line is generated from the event by a template and is a fact recorded by the harness. The second comes from the model's own explanation and is styled as a self-report. Expanding the step shows the raw request and result.

## Who it is for

**The main users are non-developer knowledge workers**: students, researchers, administrative and operations staff. They hand repetitive information work to an agent, but they do not know what a harness is and cannot tell from the interface whether the agent's conclusions can be trusted.

The first version focuses on tasks whose results users can understand and check for themselves:

| Scenario | Typical instruction | What gets explained |
| --- | --- | --- |
| Organizing a folder | "Sort my Downloads folder by type and project" | The intent behind every move and rename, and the confirmation for each |
| Literature summary | "Summarize the research methods in these 12 PDFs" | Which files were read, and which page each conclusion came from |
| Notes to to-dos | "Turn this week's meeting notes into a to-do list" | Where each to-do came from |

## Quick start (v0)

Requires [Bun](https://bun.sh) 1.3 or later.

```bash
bun install
```

Set an API key for at least one provider, either as environment variables or in a `.env` file at the project root (ignored by git). To use a relay, also set its base URL:

| Provider | Key | Base URL (optional) |
| --- | --- | --- |
| Anthropic | `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) | `ANTHROPIC_BASE_URL` |
| DeepSeek | `DEEPSEEK_API_KEY` | `DEEPSEEK_BASE_URL` |

Values in `.env` take precedence over environment variables with the same name, so tools that preset variables like `ANTHROPIC_BASE_URL` will not get in the way. Empty values in `.env` are ignored.

Run a task in a workspace, then replay it from the log:

```bash
bun src/cli.ts run --provider anthropic --workspace examples/untested-functions "Find all exported functions that have no tests."
bun src/cli.ts replay <sessionId>
```

Or use the local web UI: it shows each turn live, lets you ask follow-up questions in the same session (also after restarting Seam), and can replay past sessions step by step:

```bash
bun run dev
```

Open the link printed in the terminal; it contains an access token, and the server only listens on `127.0.0.1`. In the web UI, writing files and running commands are always denied for now.

In the command line, reading and searching are allowed automatically; writing files and running commands ask for your approval in the terminal. Every session is logged to `~/.seam/sessions/<sessionId>.jsonl` (set `SEAM_HOME` to change this), including the exact HTTP request sent to the model, with credentials redacted.

## Roadmap

Each new source of context is added only after its explanation has been designed.

- [x] **v0 Foundation**: a command-line agent with 4 tools and a complete event log
- [ ] **v1 Explainable core** (target: end of January 2027): local web UI, permission explanations, plan approval, task map, reading coverage map, fact/self-report separation, conclusion tracing
- [ ] **v2 Desk, memory and Skills**: visible and editable context, project memory, mid-run steering, rewind and branching, multiple providers
- [ ] **v3 The outside world**: browser automation, dual-view web pages, injection warnings, MCP, counterfactual replay
- [ ] **v4 While you are away**: scheduled tasks and after-the-fact review

## Tech stack

| Layer | Choice |
| --- | --- |
| Agent loop | [`@earendil-works/pi-agent-core`](https://www.npmjs.com/package/@earendil-works/pi-agent-core) (pinned to an exact version) |
| Model access | [`@earendil-works/pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai): Anthropic + DeepSeek |
| Runtime | Bun + TypeScript |
| UI | Local web server + React + Tailwind, English and Chinese |
| Storage | Local JSONL event log, no database |

## Non-goals

- Matching the full feature set of existing agent products
- Model-internal interpretability (activations, features, attention)
- Presenting the model's self-reports as the real reasons behind its decisions
