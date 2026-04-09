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
  writeWorkspaceFile,
  TASKS_DIR
} from "../src/core";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const todo = new TodoManager();
const background = new BackgroundManager();
const schedulesDir = join(TASKS_DIR, "schedules");
mkdirSync(schedulesDir, { recursive: true });

class CronScheduler {
  schedules: Map<string, { id: string; cron: string; prompt: string; recurring: boolean; durable: boolean; last_fired_at: number | null }> = new Map();

  constructor(private readonly dir: string) {
    if (existsSync(dir)) {
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
        const schedule = JSON.parse(readFileSync(join(dir, file), "utf8"));
        this.schedules.set(schedule.id, schedule);
      }
    }
    // Start time checker in background
    this.startChecker();
  }

  private startChecker() {
    setInterval(() => {
      const now = new Date();
      for (const [id, schedule] of this.schedules) {
        if (this.cronMatches(schedule.cron, now) && this.shouldFire(schedule)) {
          schedule.last_fired_at = Date.now() / 1000;
          if (schedule.durable) {
            writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(schedule, null, 2));
          }
          background.notifications.push({
            task_id: id,
            status: "triggered",
            result: schedule.prompt
          });
          if (!schedule.recurring) {
            this.schedules.delete(id);
          }
        }
      }
    }, 60_000); // Check every minute
  }

  private cronMatches(cron: string, date: Date): boolean {
    const parts = cron.split(" ");
    if (parts.length !== 5) return false;
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    const match = (pattern: string, value: number) => {
      if (pattern === "*") return true;
      if (pattern.startsWith("*/")) {
        const step = Number(pattern.slice(2));
        return value % step === 0;
      }
      return Number(pattern) === value;
    };
    return (
      match(minute, date.getMinutes()) &&
      match(hour, date.getHours()) &&
      match(dayOfMonth, date.getDate()) &&
      match(month, date.getMonth() + 1) &&
      match(dayOfWeek, date.getDay())
    );
  }

  private shouldFire(schedule: { last_fired_at: number | null }): boolean {
    if (schedule.last_fired_at == null) return true;
    const now = Date.now() / 1000;
    return now - schedule.last_fired_at > 60; // At least 60 seconds since last fire
  }

  create(id: string, cron: string, prompt: string, recurring = true, durable = true) {
    const schedule = { id, cron, prompt, recurring, durable, last_fired_at: null };
    this.schedules.set(id, schedule);
    if (durable) {
      writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(schedule, null, 2));
    }
    return JSON.stringify(schedule, null, 2);
  }

  list() {
    if (this.schedules.size === 0) return "No schedules.";
    return [...this.schedules.values()].map((s) => `[${s.id}] ${s.cron} -> ${s.prompt.slice(0, 40)}`).join("\n");
  }

  delete(id: string) {
    this.schedules.delete(id);
    const path = join(this.dir, `${id}.json`);
    if (existsSync(path)) {
      writeFileSync(path, "", "utf8");
    }
    return `Deleted schedule ${id}`;
  }
}

const scheduler = new CronScheduler(schedulesDir);
const system = createSystemPrompt(
  "Use schedule_create, schedule_list, and schedule_delete for time-based triggers. Background notifications feed back into the loop."
);

const tools = [
  { name: "bash", description: "Run a shell command.", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
  { name: "read_file", description: "Read file contents.", input_schema: { type: "object", properties: { path: { type: "string" }, limit: { type: "integer" } }, required: ["path"] } },
  { name: "write_file", description: "Write content to file.", input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "edit_file", description: "Replace exact text in file.", input_schema: { type: "object", properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } }, required: ["path", "old_text", "new_text"] } },
  { name: "TodoWrite", description: "Update task tracking list.", input_schema: { type: "object", properties: { items: { type: "array" } }, required: ["items"] } },
  { name: "background_run", description: "Run command in background.", input_schema: { type: "object", properties: { command: { type: "string" }, timeout: { type: "integer" } }, required: ["command"] } },
  { name: "check_background", description: "Check background task status.", input_schema: { type: "object", properties: { task_id: { type: "string" } } } },
  { name: "schedule_create", description: "Create a cron schedule.", input_schema: { type: "object", properties: { id: { type: "string" }, cron: { type: "string" }, prompt: { type: "string" }, recurring: { type: "boolean" }, durable: { type: "boolean" } }, required: ["id", "cron", "prompt"] } },
  { name: "schedule_list", description: "List all schedules.", input_schema: { type: "object", properties: {} } },
  { name: "schedule_delete", description: "Delete a schedule.", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } }
];

export async function runS14(history: Message[]) {
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
      schedule_create: ({ id, cron, prompt, recurring, durable }) => scheduler.create(id, cron, prompt, recurring ?? true, durable ?? true),
      schedule_list: () => scheduler.list(),
      schedule_delete: ({ id }) => scheduler.delete(id)
    },
    messages: history,
    todoManager: todo,
    backgroundManager: background
  });
}

if (isMainModule(import.meta.url)) {
  await startRepl({ sessionId: "s14", runTurn: runS14 });
}