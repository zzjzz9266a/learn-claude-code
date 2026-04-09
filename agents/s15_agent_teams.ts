import {
  MessageBus,
  TodoManager,
  createSystemPrompt,
  editWorkspaceFile,
  isMainModule,
  readWorkspaceFile,
  runAgentLoop,
  runCommand,
  startRepl,
  type Message,
  writeWorkspaceFile,
  TEAM_DIR
} from "../src/core";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const todo = new TodoManager();
const bus = new MessageBus();
const rosterDir = join(TEAM_DIR, "roster");
mkdirSync(rosterDir, { recursive: true });

class TeammateManager {
  teammates: Map<string, { name: string; role: string; status: string }> = new Map();

  constructor(private readonly dir: string) {
    if (existsSync(dir)) {
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
        const teammate = JSON.parse(readFileSync(join(dir, file), "utf8"));
        this.teammates.set(teammate.name, teammate);
      }
    }
  }

  register(name: string, role: string) {
    const teammate = { name, role, status: "active" };
    this.teammates.set(name, teammate);
    writeFileSync(join(this.dir, `${name}.json`), JSON.stringify(teammate, null, 2));
    return JSON.stringify(teammate, null, 2);
  }

  list() {
    if (this.teammates.size === 0) return "No teammates registered.";
    return [...this.teammates.values()].map((t) => `[${t.status}] ${t.name} (${t.role})`).join("\n");
  }

  updateStatus(name: string, status: string) {
    const teammate = this.teammates.get(name);
    if (!teammate) return `Unknown teammate: ${name}`;
    teammate.status = status;
    writeFileSync(join(this.dir, `${name}.json`), JSON.stringify(teammate, null, 2));
    return JSON.stringify(teammate, null, 2);
  }

  remove(name: string) {
    this.teammates.delete(name);
    return `Removed teammate ${name}`;
  }
}

const teammates = new TeammateManager(rosterDir);
const system = createSystemPrompt(
  "Use teammate_register, teammate_list, send_message, broadcast, and read_inbox for multi-agent coordination."
);

const tools = [
  { name: "bash", description: "Run a shell command.", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
  { name: "read_file", description: "Read file contents.", input_schema: { type: "object", properties: { path: { type: "string" }, limit: { type: "integer" } }, required: ["path"] } },
  { name: "write_file", description: "Write content to file.", input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "edit_file", description: "Replace exact text in file.", input_schema: { type: "object", properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } }, required: ["path", "old_text", "new_text"] } },
  { name: "TodoWrite", description: "Update task tracking list.", input_schema: { type: "object", properties: { items: { type: "array" } }, required: ["items"] } },
  { name: "teammate_register", description: "Register a teammate.", input_schema: { type: "object", properties: { name: { type: "string" }, role: { type: "string" } }, required: ["name", "role"] } },
  { name: "teammate_list", description: "List all teammates.", input_schema: { type: "object", properties: {} } },
  { name: "teammate_update", description: "Update teammate status.", input_schema: { type: "object", properties: { name: { type: "string" }, status: { type: "string" } }, required: ["name", "status"] } },
  { name: "teammate_remove", description: "Remove a teammate.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "send_message", description: "Send message to a teammate.", input_schema: { type: "object", properties: { to: { type: "string" }, content: { type: "string" } }, required: ["to", "content"] } },
  { name: "broadcast", description: "Broadcast to all teammates.", input_schema: { type: "object", properties: { content: { type: "string" } }, required: ["content"] } },
  { name: "read_inbox", description: "Read inbox for lead agent.", input_schema: { type: "object", properties: {} } }
];

export async function runS15(history: Message[]) {
  await runAgentLoop({
    system,
    tools,
    handlers: {
      bash: ({ command }) => runCommand(command),
      read_file: ({ path, limit }) => readWorkspaceFile(path, limit),
      write_file: ({ path, content }) => writeWorkspaceFile(path, content),
      edit_file: ({ path, old_text, new_text }) => editWorkspaceFile(path, old_text, new_text),
      TodoWrite: ({ items }) => todo.update(items),
      teammate_register: ({ name, role }) => teammates.register(name, role),
      teammate_list: () => teammates.list(),
      teammate_update: ({ name, status }) => teammates.updateStatus(name, status),
      teammate_remove: ({ name }) => teammates.remove(name),
      send_message: ({ to, content }) => bus.send("lead", to, content),
      broadcast: ({ content }) => bus.broadcast("lead", content, [...teammates.teammates.keys()]),
      read_inbox: () => JSON.stringify(bus.readInbox("lead"), null, 2)
    },
    messages: history,
    todoManager: todo,
    messageBus: bus
  });
}

if (isMainModule(import.meta.url)) {
  await startRepl({ sessionId: "s15", runTurn: runS15 });
}