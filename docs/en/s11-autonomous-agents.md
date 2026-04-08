# s11: Autonomous Agents

`s01 > s02 > s03 > s04 > s05 > s06 | s07 > s08 > s09 > s10 > [ s11 ] s12`

> *"Teammates scan the board and claim tasks themselves"* -- no need for the lead to assign each one.
>
> **Harness layer**: Autonomy -- models that find work without being told.

## Problem

In s09-s10, teammates only work when explicitly told to. The lead must spawn each one with a specific prompt. 10 unclaimed tasks on the board? The lead assigns each one manually. Doesn't scale.

True autonomy: teammates scan the task board themselves, claim unclaimed tasks, work on them, then look for more.

One subtlety: after context compression (s06), the agent might forget who it is. Identity re-injection fixes this.

## Solution

```
Teammate lifecycle with idle cycle:

+-------+
| spawn |
+---+---+
    |
    v
+-------+   tool_use     +-------+
| WORK  | <------------- |  LLM  |
+---+---+                +-------+
    |
    | stop_reason != tool_use (or idle tool called)
    v
+--------+
|  IDLE  |  poll every 5s for up to 60s
+---+----+
    |
    +---> check inbox --> message? ----------> WORK
    |
    +---> scan .tasks/ --> unclaimed? -------> claim -> WORK
    |
    +---> 60s timeout ----------------------> SHUTDOWN

Identity re-injection after compression:
  if len(messages) <= 3:
    messages.insert(0, identity_block)
```

## How It Works

1. The teammate loop has two phases: WORK and IDLE. When the LLM stops calling tools (or calls `idle`), the teammate enters IDLE.

```ts
while (true) {
  // WORK phase
  const response = await client.messages.create({ /* ... */ });
  if (response.stop_reason !== "tool_use" || idleRequested) {
    teammate.status = "idle";
    const resume = await idlePoll(name, messages);
    if (!resume) {
      teammate.status = "shutdown";
      return;
    }
    teammate.status = "working";
  }
}
```

2. The idle phase polls inbox and task board in a loop.

```ts
async function idlePoll(name: string, messages: Message[]) {
  for (let i = 0; i < IDLE_TIMEOUT / POLL_INTERVAL; i += 1) {
    await sleep(POLL_INTERVAL * 1000);
    const inbox = bus.readInbox(name);
    if (inbox.length > 0) {
      messages.push({ role: "user", content: `<inbox>${JSON.stringify(inbox)}</inbox>` });
      return true;
    }
    const task = findUnclaimedTask();
    if (task) {
      tasks.claim(task.id, name);
      messages.push({ role: "user", content: `<auto-claimed>Task #${task.id}: ${task.subject}</auto-claimed>` });
      return true;
    }
  }
  return false;
}
```

3. Task board scanning: find pending, unowned, unblocked tasks.

```ts
function findUnclaimedTask() {
  return readdirSync(TASKS_DIR)
    .filter((name) => /^task_\d+\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(join(TASKS_DIR, name), "utf8")))
    .find((task) => task.status === "pending" && !task.owner && !(task.blockedBy?.length));
}
```

4. Identity re-injection: when context is too short (compression happened), insert an identity block.

```ts
if (messages.length <= 3) {
  messages.unshift({
    role: "user",
    content: `<identity>You are '${name}', role: ${role}, team: ${teamName}.</identity>`,
  });
  messages.splice(1, 0, {
    role: "assistant",
    content: `I am ${name}. Continuing.`,
  });
}
```

## What Changed From s10

| Component      | Before (s10)     | After (s11)                |
|----------------|------------------|----------------------------|
| Tools          | 12               | 14 (+idle, +claim_task)    |
| Autonomy       | Lead-directed    | Self-organizing            |
| Idle phase     | None             | Poll inbox + task board    |
| Task claiming  | Manual only      | Auto-claim unclaimed tasks |
| Identity       | System prompt    | + re-injection after compress|
| Timeout        | None             | 60s idle -> auto shutdown  |

## Try It

```sh
cd learn-claude-code
npm run s11
```

1. `Create 3 tasks on the board, then spawn alice and bob. Watch them auto-claim.`
2. `Spawn a coder teammate and let it find work from the task board itself`
3. `Create tasks with dependencies. Watch teammates respect the blocked order.`
4. Type `/tasks` to see the task board with owners
5. Type `/team` to monitor who is working vs idle
