import { createSystemPrompt, runAgentLoop, runCommand, startRepl, type Message, isMainModule } from "../src/core";

const system = createSystemPrompt("Use bash to solve tasks. Act, don't explain.");
const tools = [
  {
    name: "bash",
    description: "Run a shell command.",
    input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] }
  }
];

export async function runS01(history: Message[]) {
  await runAgentLoop({
    system,
    tools,
    handlers: {
      bash: ({ command }) => runCommand(command)
    },
    messages: history
  });
}

if (isMainModule(import.meta.url)) {
  await startRepl({ sessionId: "s01", runTurn: runS01 });
}
