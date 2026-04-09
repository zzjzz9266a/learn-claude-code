import {
  MessageBus,
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
  writeWorkspaceFile,
  IDLE_TIMEOUT,
  TEAM_DIR
} from "../src/core";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const todo = new TodoManager();
const tasks = new TaskManager();
const bus = new MessageBus();
const claimsDir = join(TEAM_DIR, "claims");
mkdirSync(claimsDir, { recursive: true });

class ClaimManager {
  claims: Map<number, { task_id: number; owner: string; claimed_at: number }> = new Map();
  identity: string = "agent_" + process.pid;

  constructor(private readonly dir: string) {
    if (existsSync(dir)) {
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
        const claim = JSON.parse(readFileSync(join(dir, file), "utf8"));
        this.claims.set(claim.task_id, claim);
      }
    }
  }

  isClaimable(taskId: number): boolean {
    if (!tasks.exists(taskId)) return false;
    const task = JSON.parse(readFileSync(join(".tasks", `task_${taskId}.json`), "utf8"));
    if (task.status !== "pending") return false;
    if (task.blockedBy && task.blockedBy.length > 0) return false;
    if (this.claims.has(taskId)) return false;
    return true;
  }

  claim(taskId: number): string {
    if (!this.isClaimable(taskId)) {
      return `Cannot claim task ${taskId}`;
    }
    const claim = { task_id: taskId, owner: this.identity, claimed_at: Date.now() / 1000 };
    this.claims.set(taskId, claim);
    writeFileSync(join(this.dir, `task_${taskId}.json`), JSON.stringify(claim, null, 2));
    tasks.claim(taskId, this.identity);
    return JSON.stringify(claim, null, 2);
  }

  release(taskId: number): string {
    const claim = this.claims.get(taskId);
    if (!claim) return `No claim for task ${taskId}`;
    if (claim.owner !== this.identity) return `Not owner of task ${taskId}`;
    this.claims.delete(taskId);
    writeFileSync(join(this.dir, `task_${taskId}.json`), "", "utf8");
    return `Released task ${taskId}`;
  }

  ensureIdentity(history: Message[]) {
    const hasIdentity = history.some((m) => m.role === "user" && typeof m.content === "string" && m.content.includes(`<identity>${this.identity}</identity>`));
    if (!hasIdentity) {
      history.push({ role: "user", content: `<identity>${this.identity}</identity>` });
    }
  }

  checkIdle(history: Message[]): boolean {
    const lastUserMsg = [...history].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return false;
    // In a real implementation, we'd check timestamps
    return false;
  }
}

const claims = new ClaimManager(claimsDir);
const system = createSystemPrompt(
  "Check for idle state, claim available tasks, and resume work autonomously. Use ensure_identity to set context."
);

const tools = [
  { name: "bash", description: "Run a shell command.", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
  { name: "read_file", description: "Read file contents.", input_schema: { type: "object", properties: { path: { type: "string" }, limit: { type: "integer" } }, required: ["path"] } },
  { name: "write_file", description: "Write content to file.", input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "edit_file", description: "Replace exact text in file.", input_schema: { type: "object", properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } }, required: ["path", "old_text", "new_text"] } },
  { name: "TodoWrite", description: "Update task tracking list.", input_schema: { type: "object", properties: { items: { type: "array" } }, required: ["items"] } },
  { name: "task_list", description: "List all tasks.", input_schema: { type: "object", properties: {} } },
  { name: "task_get", description: "Get task details.", input_schema: { type: "object", properties: { task_id: { type: "integer" } }, required: ["task_id"] } },
  { name: "task_update", description: "Update task status.", input_schema: { type: "object", properties: { task_id: { type: "integer" } }, required: ["task_id"] } },
  { name: "is_claimable", description: "Check if task can be claimed.", input_schema: { type: "object", properties: { task_id: { type: "integer" } }, required: ["task_id"] } },
  { name: "claim_task", description: "Claim a task.", input_schema: { type: "object", properties: { task_id: { type: "integer" } }, required: ["task_id"] } },
  { name: "release_task", description: "Release a claimed task.", input_schema: { type: "object", properties: { task_id: { type: "integer" } }, required: ["task_id"] } },
  { name: "ensure_identity", description: "Set identity context.", input_schema: { type: "object", properties: {} } },
  { name: "read_inbox", description: "Read inbox.", input_schema: { type: "object", properties: {} } }
];

export async function runS17(history: Message[]) {
  claims.ensureIdentity(history);
  await runAgentLoop({
    system,
    tools,
    handlers: {
      bash: ({ command }) => runCommand(command),
      read_file: ({ path, limit }) => readWorkspaceFile(path, limit),
      write_file: ({ path, content }) => writeWorkspaceFile(path, content),
      edit_file: ({ path, old_text, new_text }) => editWorkspaceFile(path, old_text, new_text),
      TodoWrite: ({ items }) => todo.update(items),
      task_list: () => tasks.listAll(),
      task_get: ({ task_id }) => tasks.get(task_id),
      task_update: ({ task_id, status, add_blocked_by, remove_blocked_by }) => tasks.update(task_id, status, add_blocked_by, remove_blocked_by),
      is_claimable: ({ task_id }) => String(claims.isClaimable(task_id)),
      claim_task: ({ task_id }) => claims.claim(task_id),
      release_task: ({ task_id }) => claims.release(task_id),
      ensure_identity: () => { claims.ensureIdentity(history); return `Identity: ${claims.identity}`; },
      read_inbox: () => JSON.stringify(bus.readInbox("lead"), null, 2)
    },
    messages: history,
    todoManager: todo,
    messageBus: bus
  });
}

if (isMainModule(import.meta.url)) {
  await startRepl({ sessionId: "s17", runTurn: runS17 });
}