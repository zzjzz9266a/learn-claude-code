import {
  BackgroundManager,
  TaskManager,
  TodoManager,
  createSystemPrompt,
  editWorkspaceFile,
  isMainModule,
  readWorkspaceFile,
  runAgentLoop,
  runCommand,
  startRepl,
  type Message,
  writeWorkspaceFile
} from "../src/core";

const todo = new TodoManager();
const tasks = new TaskManager();
const background = new BackgroundManager();
const system = createSystemPrompt(
  "Use task_create, task_update, task_list, background_run, and check_background to keep working while slow commands run."
);
const tools = [
  {
    name: "bash",
    description: "Run a shell command.",
    input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] }
  },
  {
    name: "read_file",
    description: "Read file contents.",
    input_schema: { type: "object", properties: { path: { type: "string" }, limit: { type: "integer" } }, required: ["path"] }
  },
  {
    name: "write_file",
    description: "Write content to file.",
    input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] }
  },
  {
    name: "edit_file",
    description: "Replace exact text in file.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } },
      required: ["path", "old_text", "new_text"]
    }
  },
  {
    name: "TodoWrite",
    description: "Update task tracking list.",
    input_schema: { type: "object", properties: { items: { type: "array" } }, required: ["items"] }
  },
  {
    name: "task_create",
    description: "Create a persistent file task.",
    input_schema: { type: "object", properties: { subject: { type: "string" }, description: { type: "string" } }, required: ["subject"] }
  },
  {
    name: "task_get",
    description: "Get task details by ID.",
    input_schema: { type: "object", properties: { task_id: { type: "integer" } }, required: ["task_id"] }
  },
  {
    name: "task_update",
    description: "Update task status or dependencies.",
    input_schema: { type: "object", properties: { task_id: { type: "integer" } }, required: ["task_id"] }
  },
  {
    name: "task_list",
    description: "List all tasks.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "background_run",
    description: "Run command in background thread.",
    input_schema: { type: "object", properties: { command: { type: "string" }, timeout: { type: "integer" } }, required: ["command"] }
  },
  {
    name: "check_background",
    description: "Check background task status.",
    input_schema: { type: "object", properties: { task_id: { type: "string" } } }
  }
];

export async function runS08(history: Message[]) {
  await runAgentLoop({
    system,
    tools,
    handlers: {
      bash: ({ command }) => runCommand(command),
      read_file: ({ path, limit }) => readWorkspaceFile(path, limit),
      write_file: ({ path, content }) => writeWorkspaceFile(path, content),
      edit_file: ({ path, old_text, new_text }) => editWorkspaceFile(path, old_text, new_text),
      TodoWrite: ({ items }) => todo.update(items),
      task_create: ({ subject, description }) => tasks.create(subject, description),
      task_get: ({ task_id }) => tasks.get(task_id),
      task_update: ({ task_id, status, add_blocked_by, remove_blocked_by }) =>
        tasks.update(task_id, status, add_blocked_by, remove_blocked_by),
      task_list: () => tasks.listAll(),
      background_run: ({ command, timeout }) => background.run(command, timeout),
      check_background: ({ task_id }) => background.check(task_id)
    },
    messages: history,
    todoManager: todo,
    backgroundManager: background
  });
}

if (isMainModule(import.meta.url)) {
  await startRepl({ sessionId: "s08", runTurn: runS08 });
}
