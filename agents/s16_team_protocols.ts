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
  TEAM_DIR,
  VALID_MSG_TYPES
} from "../src/core";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const todo = new TodoManager();
const bus = new MessageBus();
const requestsDir = join(TEAM_DIR, "requests");
mkdirSync(requestsDir, { recursive: true });

class RequestStore {
  requests: Map<string, { id: string; from: string; to: string; type: string; content: string; status: string }> = new Map();

  constructor(private readonly dir: string) {
    if (existsSync(dir)) {
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
        const request = JSON.parse(readFileSync(join(dir, file), "utf8"));
        this.requests.set(request.id, request);
      }
    }
  }

  create(from: string, to: string, type: string, content: string) {
    const id = `req_${Date.now()}`;
    const request = { id, from, to, type, content, status: "pending" };
    this.requests.set(id, request);
    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(request, null, 2));
    bus.send(from, to, content, type, { request_id: id });
    return JSON.stringify(request, null, 2);
  }

  respond(id: string, response: string) {
    const request = this.requests.get(id);
    if (!request) return `Unknown request: ${id}`;
    request.status = "responded";
    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(request, null, 2));
    bus.send(request.to, request.from, response, `${request.type}_response`, { request_id: id });
    return JSON.stringify(request, null, 2);
  }

  list() {
    if (this.requests.size === 0) return "No requests.";
    return [...this.requests.values()].map((r) => `[${r.status}] ${r.id}: ${r.type} from ${r.from} to ${r.to}`).join("\n");
  }
}

const requests = new RequestStore(requestsDir);
const system = createSystemPrompt(
  `Use request_create and request_respond for structured protocols. Valid message types: ${[...VALID_MSG_TYPES].join(", ")}.`
);

const tools = [
  { name: "bash", description: "Run a shell command.", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
  { name: "read_file", description: "Read file contents.", input_schema: { type: "object", properties: { path: { type: "string" }, limit: { type: "integer" } }, required: ["path"] } },
  { name: "write_file", description: "Write content to file.", input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "edit_file", description: "Replace exact text in file.", input_schema: { type: "object", properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } }, required: ["path", "old_text", "new_text"] } },
  { name: "TodoWrite", description: "Update task tracking list.", input_schema: { type: "object", properties: { items: { type: "array" } }, required: ["items"] } },
  { name: "send_message", description: "Send message to a teammate.", input_schema: { type: "object", properties: { to: { type: "string" }, content: { type: "string" }, type: { type: "string" } }, required: ["to", "content"] } },
  { name: "read_inbox", description: "Read inbox for lead agent.", input_schema: { type: "object", properties: {} } },
  { name: "request_create", description: "Create a protocol request.", input_schema: { type: "object", properties: { to: { type: "string" }, type: { type: "string" }, content: { type: "string" } }, required: ["to", "type", "content"] } },
  { name: "request_respond", description: "Respond to a request.", input_schema: { type: "object", properties: { id: { type: "string" }, response: { type: "string" } }, required: ["id", "response"] } },
  { name: "request_list", description: "List all requests.", input_schema: { type: "object", properties: {} } }
];

export async function runS16(history: Message[]) {
  await runAgentLoop({
    system,
    tools,
    handlers: {
      bash: ({ command }) => runCommand(command),
      read_file: ({ path, limit }) => readWorkspaceFile(path, limit),
      write_file: ({ path, content }) => writeWorkspaceFile(path, content),
      edit_file: ({ path, old_text, new_text }) => editWorkspaceFile(path, old_text, new_text),
      TodoWrite: ({ items }) => todo.update(items),
      send_message: ({ to, content, type }) => bus.send("lead", to, content, type),
      read_inbox: () => JSON.stringify(bus.readInbox("lead"), null, 2),
      request_create: ({ to, type, content }) => requests.create("lead", to, type, content),
      request_respond: ({ id, response }) => requests.respond(id, response),
      request_list: () => requests.list()
    },
    messages: history,
    todoManager: todo,
    messageBus: bus
  });
}

if (isMainModule(import.meta.url)) {
  await startRepl({ sessionId: "s16", runTurn: runS16 });
}