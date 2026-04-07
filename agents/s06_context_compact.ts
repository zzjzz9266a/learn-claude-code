import {
  SkillLoader,
  SKILLS_DIR,
  TodoManager,
  autoCompact,
  createClient,
  createSystemPrompt,
  editWorkspaceFile,
  estimateTokens,
  isMainModule,
  microcompact,
  readWorkspaceFile,
  runAgentLoop,
  runCommand,
  startRepl,
  TOKEN_THRESHOLD,
  type Message,
  writeWorkspaceFile
} from "../src/core";

const skills = new SkillLoader(SKILLS_DIR);
const todo = new TodoManager();
const client = createClient();
const system = createSystemPrompt(
  `Use tools to solve tasks. Manage short plans with TodoWrite, load knowledge with load_skill, and compact context when needed.\nSkills:\n${skills.descriptions()}`
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
    name: "load_skill",
    description: "Load specialized knowledge by name.",
    input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] }
  },
  {
    name: "compress",
    description: "Manually compress conversation context.",
    input_schema: { type: "object", properties: {} }
  }
];

export async function runS06(history: Message[]) {
  microcompact(history);
  if (estimateTokens(history) > TOKEN_THRESHOLD) {
    const compacted = await autoCompact(history, client);
    history.splice(0, history.length, ...compacted);
  }
  await runAgentLoop({
    system,
    tools,
    handlers: {
      bash: ({ command }) => runCommand(command),
      read_file: ({ path, limit }) => readWorkspaceFile(path, limit),
      write_file: ({ path, content }) => writeWorkspaceFile(path, content),
      edit_file: ({ path, old_text, new_text }) => editWorkspaceFile(path, old_text, new_text),
      load_skill: ({ name }) => skills.load(name),
      TodoWrite: ({ items }) => todo.update(items),
      compress: () => "Compressing..."
    },
    messages: history,
    todoManager: todo,
    compressClient: client
  });
}

if (isMainModule(import.meta.url)) {
  await startRepl({ sessionId: "s06", runTurn: runS06 });
}
