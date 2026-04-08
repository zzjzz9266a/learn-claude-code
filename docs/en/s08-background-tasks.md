# s08: Background Tasks

`s01 > s02 > s03 > s04 > s05 > s06 | s07 > [ s08 ] s09 > s10 > s11 > s12`

> *"Run slow operations in the background; the agent keeps thinking"* -- background tasks run commands, inject notifications on completion.
>
> **Harness layer**: Background execution -- the model thinks while the harness waits.

## Problem

Some commands take minutes: `npm install`, `npm test`, `docker build`. With a blocking loop, the model sits idle waiting. If the user asks "install dependencies and while that runs, create the config file," the agent does them sequentially, not in parallel.

## Solution

```
Main thread                Background thread
+-----------------+        +-----------------+
| agent loop      |        | subprocess runs |
| ...             |        | ...             |
| [LLM call] <---+------- | enqueue(result) |
|  ^drain queue   |        +-----------------+
+-----------------+

Timeline:
Agent --[spawn A]--[spawn B]--[other work]----
             |          |
             v          v
          [A runs]   [B runs]      (parallel)
             |          |
             +-- results injected before next LLM call --+
```

## How It Works

1. BackgroundManager tracks tasks in a map and stores completed notifications for later injection.

```ts
class BackgroundManager {
  tasks = new Map<string, { status: string; command: string; result: string | null }>();
  notifications: Array<{ task_id: string; status: string; result: string }> = [];
}
```

2. `run()` creates a task record, starts the command asynchronously, and returns immediately.

```ts
run(command: string, timeout = 120) {
  const taskId = randomUUID().slice(0, 8);
  this.tasks.set(taskId, { status: "running", command, result: null });
  void runCommand(command, WORKDIR, timeout * 1000).then((result) => {
    const status = result.startsWith("Error:") ? "error" : "completed";
    this.tasks.set(taskId, { status, command, result });
    this.notifications.push({ task_id: taskId, status, result: result.slice(0, 500) });
  });
  return `Background task ${taskId} started: ${command.slice(0, 80)}`;
}
```

3. When the command finishes, its result goes into the notification list.

```ts
this.notifications.push({
  task_id: taskId,
  status,
  result: result.slice(0, 500),
});
```

4. The agent loop drains notifications before each LLM call.

```ts
async function agentLoop(messages: Message[]) {
  while (true) {
    const notifs = background.drain();
    if (notifs.length > 0) {
      const notifText = notifs
        .map((item) => `[bg:${item.task_id}] ${item.status}: ${item.result}`)
        .join("\n");
      messages.push({
        role: "user",
        content: `<background-results>\n${notifText}\n</background-results>`,
      });
    }
    const response = await client.messages.create({ /* ... */ });
  }
}
```

The loop stays single-threaded. Only subprocess I/O is parallelized.

## What Changed From s07

| Component      | Before (s07)     | After (s08)                |
|----------------|------------------|----------------------------|
| Tools          | 8                | 6 (base + background_run + check)|
| Execution      | Blocking only    | Blocking + background tasks |
| Notification   | None             | Notification list drained per loop |
| Concurrency    | None             | Async command completion    |

## Try It

```sh
cd learn-claude-code
npm run s08
```

1. `Run "sleep 5 && echo done" in the background, then create a file while it runs`
2. `Start 3 background tasks: "sleep 2", "sleep 4", "sleep 6". Check their status.`
3. `Run npm test in the background and keep working on other things`
