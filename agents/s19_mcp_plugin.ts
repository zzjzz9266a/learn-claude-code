import {
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
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const todo = new TodoManager();
const mcpDir = join(process.cwd(), ".mcp");
mkdirSync(mcpDir, { recursive: true });

interface MCPTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  serverName: string;
}

class MCPClient {
  private process: ReturnType<typeof spawn> | null = null;
  tools: MCPTool[] = [];

  constructor(
    private readonly serverName: string,
    private readonly command: string,
    private readonly args: string[] = [],
    private readonly env: Record<string, string> = {}
  ) {}

  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.process = spawn(this.command, this.args, {
        env: { ...process.env, ...this.env },
        stdio: ["pipe", "pipe", "pipe"]
      });

      this.process.stderr?.on("data", (data) => {
        console.error(`[${this.serverName}] ${data}`);
      });

      // Send initialize request
      this.sendRequest("initialize", { protocolVersion: "2024-11-05" })
        .then(() => this.sendRequest("tools/list", {}))
        .then((result: any) => {
          this.tools = (result.tools || []).map((t: any) => ({
            name: `mcp__${this.serverName}__${t.name}`,
            description: t.description || "",
            input_schema: t.inputSchema || { type: "object" },
            serverName: this.serverName
          }));
          resolve(`Started MCP server: ${this.serverName}`);
        })
        .catch(reject);
    });
  }

  private async sendRequest(method: string, params: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error("Process not started"));
        return;
      }

      const request = JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params });
      const timeout = setTimeout(() => reject(new Error("Timeout")), 30_000);

      const handler = (data: Buffer) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.id === Date.now()) {
            clearTimeout(timeout);
            this.process?.stdout?.off("data", handler);
            if (response.error) {
              reject(new Error(response.error.message));
            } else {
              resolve(response.result);
            }
          }
        } catch {}
      };

      this.process.stdout?.on("data", handler);
      this.process.stdin.write(request + "\n");
    });
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.sendRequest("tools/call", { name: toolName, arguments: args });
    return JSON.stringify(result.content || result);
  }

  stop() {
    this.process?.kill();
    this.process = null;
  }
}

class PluginLoader {
  clients: Map<string, MCPClient> = new Map();

  async loadPlugin(name: string, command: string, args: string[] = [], env: Record<string, string> = {}): Promise<string> {
    if (this.clients.has(name)) {
      return `Plugin ${name} already loaded`;
    }
    const client = new MCPClient(name, command, args, env);
    await client.start();
    this.clients.set(name, client);
    return `Loaded plugin: ${name} with ${client.tools.length} tools`;
  }

  getAllTools(): MCPTool[] {
    return [...this.clients.values()].flatMap((c) => c.tools);
  }

  async callTool(prefixedName: string, args: Record<string, unknown>): Promise<string> {
    const match = prefixedName.match(/^mcp__(.+)__(.+)$/);
    if (!match) return `Invalid MCP tool name: ${prefixedName}`;
    const [, serverName, toolName] = match;
    const client = this.clients.get(serverName);
    if (!client) return `Unknown server: ${serverName}`;
    return client.callTool(toolName, args);
  }

  listPlugins(): string {
    if (this.clients.size === 0) return "No plugins loaded.";
    return [...this.clients.entries()].map(([name, client]) => `${name}: ${client.tools.length} tools`).join("\n");
  }
}

const plugins = new PluginLoader();
const system = createSystemPrompt(
  "Use MCP tools (prefixed with mcp__) for external capabilities. Use load_plugin to connect to external servers."
);

const baseTools = [
  { name: "bash", description: "Run a shell command.", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
  { name: "read_file", description: "Read file contents.", input_schema: { type: "object", properties: { path: { type: "string" }, limit: { type: "integer" } }, required: ["path"] } },
  { name: "write_file", description: "Write content to file.", input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "edit_file", description: "Replace exact text in file.", input_schema: { type: "object", properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } }, required: ["path", "old_text", "new_text"] } },
  { name: "TodoWrite", description: "Update task tracking list.", input_schema: { type: "object", properties: { items: { type: "array" } }, required: ["items"] } },
  { name: "load_plugin", description: "Load an MCP plugin.", input_schema: { type: "object", properties: { name: { type: "string" }, command: { type: "string" }, args: { type: "array" }, env: { type: "object" } }, required: ["name", "command"] } },
  { name: "list_plugins", description: "List loaded plugins.", input_schema: { type: "object", properties: {} } }
];

export async function runS19(history: Message[]) {
  const mcpTools = plugins.getAllTools();
  const allTools = [...baseTools, ...mcpTools];

  await runAgentLoop({
    system,
    tools: allTools,
    handlers: {
      bash: ({ command }) => runCommand(command),
      read_file: ({ path, limit }) => readWorkspaceFile(path, limit),
      write_file: ({ path, content }) => writeWorkspaceFile(path, content),
      edit_file: ({ path, old_text, new_text }) => editWorkspaceFile(path, old_text, new_text),
      TodoWrite: ({ items }) => todo.update(items),
      load_plugin: ({ name, command, args, env }) => plugins.loadPlugin(name, command, args, env),
      list_plugins: () => plugins.listPlugins(),
      // Dynamic handler for MCP tools
      ...Object.fromEntries(
        mcpTools.map((t) => [t.name, (args: Record<string, unknown>) => plugins.callTool(t.name, args)])
      )
    },
    messages: history,
    todoManager: todo
  });
}

if (isMainModule(import.meta.url)) {
  await startRepl({ sessionId: "s19", runTurn: runS19 });
}