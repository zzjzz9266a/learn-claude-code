# s04: Subagents

`s01 > s02 > s03 > [ s04 ] s05 > s06 | s07 > s08 > s09 > s10 > s11 > s12`

> *"Break big tasks down; each subtask gets a clean context"* -- subagents use independent messages[], keeping the main conversation clean.
>
> **Harness layer**: Context isolation -- protecting the model's clarity of thought.

## Problem

As the agent works, its messages array grows. Every file read, every bash output stays in context permanently. "What testing framework does this project use?" might require reading 5 files, but the parent only needs the answer: "npm test."

## Solution

```
Parent agent                     Subagent
+------------------+             +------------------+
| messages=[...]   |             | messages=[]      | <-- fresh
|                  |  dispatch   |                  |
| tool: task       | ----------> | while tool_use:  |
|   prompt="..."   |             |   call tools     |
|                  |  summary    |   append results |
|   result = "..." | <---------- | return last text |
+------------------+             +------------------+

Parent context stays clean. Subagent context is discarded.
```

## How It Works

1. The parent gets a `task` tool. The child gets all base tools except `task` (no recursive spawning).

```ts
const childTools = [bashTool, readFileTool, writeFileTool, editFileTool];
const parentTools = [
  ...childTools,
  {
    name: "task",
    description: "Spawn a subagent with fresh context.",
    input_schema: {
      type: "object",
      properties: { prompt: { type: "string" } },
      required: ["prompt"],
    },
  },
];
```

2. The subagent starts with `messages=[]` and runs its own loop. Only the final text returns to the parent.

```ts
async function runSubagent(prompt: string) {
  const subMessages: Message[] = [{ role: "user", content: prompt }];

  for (let i = 0; i < 30; i += 1) {
    const response = await client.messages.create({
      model: MODEL,
      messages: subMessages,
      tools: childTools,
      max_tokens: 8000,
    });

    subMessages.push({ role: "assistant", content: response.content });
    if (response.stop_reason !== "tool_use") {
      return extractText(response.content) || "(no summary)";
    }

    const results = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const output = await childHandlers[block.name](block.input);
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: String(output).slice(0, 50_000),
      });
    }

    subMessages.push({ role: "user", content: results });
  }

  return "(subagent failed)";
}
```

The child's entire message history (possibly 30+ tool calls) is discarded. The parent receives a one-paragraph summary as a normal `tool_result`.

## What Changed From s03

| Component      | Before (s03)     | After (s04)               |
|----------------|------------------|---------------------------|
| Tools          | 5                | 5 (base) + task (parent)  |
| Context        | Single shared    | Parent + child isolation  |
| Subagent       | None             | `run_subagent()` function |
| Return value   | N/A              | Summary text only         |

## Try It

```sh
cd learn-claude-code
npm run s04
```

1. `Use a subtask to find what testing framework this project uses`
2. `Delegate: read all .ts files and summarize what each one does`
3. `Use a task to create a new module, then verify it from here`
