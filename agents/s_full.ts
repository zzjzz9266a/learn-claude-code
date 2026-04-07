import {
  BackgroundManager,
  EventBus,
  MessageBus,
  SKILLS_DIR,
  SkillLoader,
  TaskManager,
  TodoManager,
  WorktreeManager,
  createSystemPrompt,
  detectRepoRoot,
  editWorkspaceFile,
  isMainModule,
  readWorkspaceFile,
  runAgentLoop,
  runCommand,
  runSubagent,
  startRepl,
  type Message,
  writeWorkspaceFile
} from "../src/core";
import { join } from "node:path";

const repoRoot = detectRepoRoot() ?? process.cwd();
const todo = new TodoManager();
const skills = new SkillLoader(SKILLS_DIR);
const tasks = new TaskManager(join(repoRoot, ".tasks"));
const background = new BackgroundManager();
const bus = new MessageBus();
const events = new EventBus(join(repoRoot, ".worktrees", "events.jsonl"));
const worktrees = new WorktreeManager(repoRoot, tasks, events);
const teammates: Array<{ name: string; role: string; status: string }> = [];

const system = createSystemPrompt(
  `Use tools to solve tasks.
Prefer task_create/task_update/task_list for multi-step work. Use TodoWrite for short checklists.
Use task for subagent delegation. Use load_skill for specialized knowledge.
Skills:
${skills.descriptions()}`
);

const tools = [
  { name: "bash", description: "Run a shell command.", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
  { name: "read_file", description: "Read file contents.", input_schema: { type: "object", properties: { path: { type: "string" }, limit: { type: "integer" } }, required: ["path"] } },
  { name: "write_file", description: "Write content to file.", input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "edit_file", description: "Replace exact text in file.", input_schema: { type: "object", properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } }, required: ["path", "old_text", "new_text"] } },
  { name: "TodoWrite", description: "Update task tracking list.", input_schema: { type: "object", properties: { items: { type: "array" } }, required: ["items"] } },
  { name: "task", description: "Spawn a subagent for isolated exploration or work.", input_schema: { type: "object", properties: { prompt: { type: "string" }, agent_type: { type: "string" } }, required: ["prompt"] } },
  { name: "load_skill", description: "Load specialized knowledge by name.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "compress", description: "Manually compress conversation context.", input_schema: { type: "object", properties: {} } },
  { name: "background_run", description: "Run command in background thread.", input_schema: { type: "object", properties: { command: { type: "string" }, timeout: { type: "integer" } }, required: ["command"] } },
  { name: "check_background", description: "Check background task status.", input_schema: { type: "object", properties: { task_id: { type: "string" } } } },
  { name: "task_create", description: "Create a persistent file task.", input_schema: { type: "object", properties: { subject: { type: "string" }, description: { type: "string" } }, required: ["subject"] } },
  { name: "task_get", description: "Get task details by ID.", input_schema: { type: "object", properties: { task_id: { type: "integer" } }, required: ["task_id"] } },
  { name: "task_update", description: "Update task status or dependencies.", input_schema: { type: "object", properties: { task_id: { type: "integer" } }, required: ["task_id"] } },
  { name: "task_list", description: "List all tasks.", input_schema: { type: "object", properties: {} } },
  { name: "spawn_teammate", description: "Register a persistent teammate placeholder.", input_schema: { type: "object", properties: { name: { type: "string" }, role: { type: "string" }, prompt: { type: "string" } }, required: ["name", "role", "prompt"] } },
  { name: "list_teammates", description: "List all teammates.", input_schema: { type: "object", properties: {} } },
  { name: "send_message", description: "Send a message to a teammate.", input_schema: { type: "object", properties: { to: { type: "string" }, content: { type: "string" }, msg_type: { type: "string" } }, required: ["to", "content"] } },
  { name: "read_inbox", description: "Read and drain the lead's inbox.", input_schema: { type: "object", properties: {} } },
  { name: "broadcast", description: "Send message to all teammates.", input_schema: { type: "object", properties: { content: { type: "string" } }, required: ["content"] } },
  { name: "worktree_create", description: "Create a git worktree lane.", input_schema: { type: "object", properties: { name: { type: "string" }, task_id: { type: "integer" }, base_ref: { type: "string" } }, required: ["name"] } },
  { name: "worktree_list", description: "List tracked worktrees.", input_schema: { type: "object", properties: {} } },
  { name: "worktree_status", description: "Show git status for a worktree.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "worktree_run", description: "Run a command inside a worktree.", input_schema: { type: "object", properties: { name: { type: "string" }, command: { type: "string" } }, required: ["name", "command"] } },
  { name: "worktree_remove", description: "Remove a worktree lane.", input_schema: { type: "object", properties: { name: { type: "string" }, force: { type: "boolean" }, complete_task: { type: "boolean" } }, required: ["name"] } },
  { name: "worktree_keep", description: "Mark a worktree as kept.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "worktree_events", description: "Read recent worktree lifecycle events.", input_schema: { type: "object", properties: { limit: { type: "integer" } } } }
];

export async function runFull(history: Message[]) {
  await runAgentLoop({
    system,
    tools,
    handlers: {
      bash: ({ command }) => runCommand(command),
      read_file: ({ path, limit }) => readWorkspaceFile(path, limit),
      write_file: ({ path, content }) => writeWorkspaceFile(path, content),
      edit_file: ({ path, old_text, new_text }) => editWorkspaceFile(path, old_text, new_text),
      TodoWrite: ({ items }) => todo.update(items),
      task: ({ prompt, agent_type }) => runSubagent(prompt, agent_type),
      load_skill: ({ name }) => skills.load(name),
      compress: () => "Compressing...",
      background_run: ({ command, timeout }) => background.run(command, timeout),
      check_background: ({ task_id }) => background.check(task_id),
      task_create: ({ subject, description }) => tasks.create(subject, description),
      task_get: ({ task_id }) => tasks.get(task_id),
      task_update: ({ task_id, status, add_blocked_by, remove_blocked_by }) =>
        tasks.update(task_id, status, add_blocked_by, remove_blocked_by),
      task_list: () => tasks.listAll(),
      spawn_teammate: ({ name, role }) => {
        teammates.push({ name, role, status: "working" });
        return `Spawned '${name}' (role: ${role})`;
      },
      list_teammates: () =>
        teammates.length === 0 ? "No teammates." : teammates.map((member) => `  ${member.name} (${member.role}): ${member.status}`).join("\n"),
      send_message: ({ to, content, msg_type }) => bus.send("lead", to, content, msg_type),
      read_inbox: () => JSON.stringify(bus.readInbox("lead"), null, 2),
      broadcast: ({ content }) => bus.broadcast("lead", content, teammates.map((member) => member.name)),
      worktree_create: ({ name, task_id, base_ref }) => worktrees.create(name, task_id, base_ref),
      worktree_list: () => worktrees.listAll(),
      worktree_status: ({ name }) => worktrees.status(name),
      worktree_run: ({ name, command }) => worktrees.run(name, command),
      worktree_remove: ({ name, force, complete_task }) => worktrees.remove(name, force, complete_task),
      worktree_keep: ({ name }) => worktrees.keep(name),
      worktree_events: ({ limit }) => events.listRecent(limit)
    },
    messages: history,
    todoManager: todo,
    backgroundManager: background,
    messageBus: bus
  });
}

if (isMainModule(import.meta.url)) {
  await startRepl({ sessionId: "s_full", runTurn: runFull });
}
