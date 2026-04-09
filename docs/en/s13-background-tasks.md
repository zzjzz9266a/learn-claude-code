# s13: Background Tasks

`s01 > s02 > s03 > s04 > s05 > s06 > s07 > s08 > s09 > s10 > s11 > s12 > [ s13 ] > s14 > s15 > s16 > s17 > s18 > s19`

## What You'll Learn

- How to run slow commands in background threads while the main loop stays responsive
- How a thread-safe notification queue delivers results back to the agent
- How daemon threads keep the process clean on exit
- How the drain-before-call pattern injects background results at exactly the right moment

You have a task graph now, and every task can express what it depends on. But there is a practical problem: some tasks involve commands that take minutes. `npm install`, `pytest`, `docker build` -- these block the main loop, and while the agent waits, the user waits too. If the user says "install dependencies and while that runs, create the config file," your agent from s12 does them sequentially because it has no way to start something and come back to it later. This chapter fixes that by adding background execution.

## The Problem

Consider a realistic workflow: the user asks the agent to run a full test suite (which takes 90 seconds) and then set up a configuration file. With a blocking loop, the agent submits the test command, stares at a spinning subprocess for 90 seconds, gets the result, and only then starts the config file. The user watches all of this happen serially. Worse, if there are three slow commands, total wall-clock time is the sum of all three -- even though they could have run in parallel. The agent needs a way to start slow work, give control back to the main loop immediately, and pick up the results later.

## The Solution

Keep the main loop single-threaded, but run slow subprocesses on background daemon threads. When a background command finishes, its result goes into a thread-safe notification queue. Before each LLM call, the main loop drains that queue and injects any completed results into the conversation.

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

**Step 1.** Create a `BackgroundManager` that tracks running tasks with a thread-safe notification queue. The lock ensures that the main thread and background threads never corrupt the queue simultaneously.

```typescript
class BackgroundManager {
  private tasks: Map<string, any> = new Map();
  private notificationQueue: any[] = [];
  private lock = new Mutex();
}
```

**Step 2.** The `run()` method starts a daemon thread and returns immediately. A daemon thread is one that the Python runtime kills automatically when the main program exits -- you do not need to join it or clean it up.

```typescript
run(command: string): string {
  const taskId = crypto.randomUUID().slice(0, 8);
  this.tasks.set(taskId, { status: "running", command: command });
  const thread = new Thread(
    () => this._execute(taskId, command),
    { daemon: true }
  );
  thread.start();
  return `Background task ${taskId} started`;
}
```

**Step 3.** When the subprocess finishes, the background thread puts its result into the notification queue. The lock makes this safe even if the main thread is draining the queue at the same time.

```typescript
async _execute(taskId: string, command: string): Promise<void> {
  let output: string;
  try {
    const r = await subprocess.run(command, {
      shell: true,
      cwd: WORKDIR,
      captureOutput: true,
      timeout: 300
    });
    output = (r.stdout + r.stderr).trim().slice(0, 50000);
  } catch (e) {
    if (e instanceof TimeoutExpired) {
      output = "Error: Timeout (300s)";
    }
  }
  this.lock.acquire();
  try {
    this.notificationQueue.push({
      taskId: taskId,
      result: output.slice(0, 500)
    });
  } finally {
    this.lock.release();
  }
}
```

**Step 4.** The agent loop drains notifications before each LLM call. This is the drain-before-call pattern: right before you ask the model to think, sweep up any background results and add them to the conversation so the model sees them in its next turn.

```typescript
async function agentLoop(messages: any[]) {
  while (true) {
    const notifs = BG.drainNotifications();
    if (notifs.length > 0) {
      const notifText = notifs
        .map(n => `[bg:${n.taskId}] ${n.result}`)
        .join("\n");
      messages.push({
        role: "user",
        content: `<background-results>\n${notifText}\n</background-results>`
      });
      messages.push({
        role: "assistant",
        content: "Noted background results."
      });
    }
    const response = await client.messages.create(...);
  }
}
```

This teaching demo keeps the core loop single-threaded; only subprocess waiting is parallelized. A production system would typically split background work into several runtime lanes, but starting with one clean pattern makes the mechanics easy to follow.

## Read Together

- If you have not fully separated "task goal" from "running execution slot," read [`s13a-runtime-task-model.md`](./s13a-runtime-task-model.md) first -- it clarifies why a task record and a runtime record are different objects.
- If you are unsure which state belongs in `RuntimeTaskRecord` and which still belongs on the task board, keep [`data-structures.md`](./data-structures.md) nearby.
- If background execution starts to feel like "another main loop," go back to [`s02b-tool-execution-runtime.md`](./s02b-tool-execution-runtime.md) and reset the boundary: execution and waiting can run in parallel, but the main loop is still one mainline.

## What Changed

| Component      | Before (s12)     | After (s13)                |
|----------------|------------------|----------------------------|
| Tools          | 8                | 6 (base + background_run + check)|
| Execution      | Blocking only    | Blocking + background threads|
| Notification   | None             | Queue drained per loop     |
| Concurrency    | None             | Daemon threads             |

## Try It

```sh
cd learn-claude-code
tsx agents/s13_background_tasks.ts
```

1. `Run "sleep 5 && echo done" in the background, then create a file while it runs`
2. `Start 3 background tasks: "sleep 2", "sleep 4", "sleep 6". Check their status.`
3. `Run pytest in the background and keep working on other things`

## What You've Mastered

At this point, you can:

- Run slow subprocesses on daemon threads without blocking the main agent loop
- Collect results through a thread-safe notification queue
- Inject background results into the conversation using the drain-before-call pattern
- Let the agent work on other things while long-running commands finish in parallel

## What's Next

Background tasks solve the problem of slow work that starts now. But what about work that should start later -- "run this every night" or "remind me in 30 minutes"? In s14 you will add a cron scheduler that stores future intent and triggers it when the time comes.

## Key Takeaway

> Background execution is a runtime lane, not a second main loop -- slow work runs on daemon threads and feeds results back through a single notification queue.
