import {
  BackgroundManager,
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
const background = new BackgroundManager();
const system = createSystemPrompt(
  "Use background_run and check_background for slow commands. Drain notifications before each turn."
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
    name: "background_run",
    description: "Run command in background thread.",
    input_schema: { type: "object", properties: { command: { type: "string" }, timeout: { type: "integer" } }, required: ["command"] }
  },
  {
    name: "check_background",
    description: "Check background task status.",
    input_schema: { type: "object", properties: { task_id: { type: "string" } } }
  },
  {
    name: "drain_notifications",
    description: "Drain all completed background notifications.",
    input_schema: { type: "object", properties: {} }
  }
];

export async function runS13(history: Message[]) {
  await runAgentLoop({
    system,
    tools,
    handlers: {
      bash: ({ command }) => runCommand(command),
      read_file: ({ path, limit }) => readWorkspaceFile(path, limit),
      write_file: ({ path, content }) => writeWorkspaceFile(path, content),
      edit_file: ({ path, old_text, new_text }) => editWorkspaceFile(path, old_text, new_text),
      TodoWrite: ({ items }) => todo.update(items),
      background_run: ({ command, timeout }) => background.run(command, timeout),
      check_background: ({ task_id }) => background.check(task_id),
      drain_notifications: () => JSON.stringify(background.drain(), null, 2)
    },
    messages: history,
    todoManager: todo,
    backgroundManager: background
  });
}

if (isMainModule(import.meta.url)) {
  await startRepl({ sessionId: "s13", runTurn: runS13 });
}