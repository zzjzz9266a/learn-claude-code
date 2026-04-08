# s11: Autonomous Agents (Autonomous Agent)

`s01 > s02 > s03 > s04 > s05 > s06 | s07 > s08 > s09 > s10 > [ s11 ] s12`

> *"队友自己看看板, 有活就认领"* -- 不需要领导逐个分配, 自组织。
>
> **Harness 层**: 自治 -- 模型自己找活干, 无需指派。

## 问题

s09-s10 中, 队友只在被明确指派时才动。领导得给每个队友写 prompt, 任务看板上 10 个未认领的任务得手动分配。这扩展不了。

真正的自治: 队友自己扫描任务看板, 认领没人做的任务, 做完再找下一个。

一个细节: Context Compact (s06) 后 Agent 可能忘了自己是谁。身份重注入解决这个问题。

## 解决方案

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

## 工作原理

1. 队友循环分两个阶段: WORK 和 IDLE。LLM 停止调用工具 (或调用了 `idle`) 时, 进入 IDLE。

```ts
async function teammateLoop(name: string, role: string, prompt: string) {
  const messages: MessageParam[] = [{ role: "user", content: prompt }];

  while (true) {
    for (let round = 0; round < 50; round += 1) {
      const response = await client.messages.create(/* ... */);
      if (response.stop_reason !== "tool_use") break;
      // execute tools...
      if (idleRequested) break;
    }

    setStatus(name, "idle");
    const resume = await idlePoll(name, messages);
    if (!resume) {
      setStatus(name, "shutdown");
      return;
    }
    setStatus(name, "working");
  }
}
```

2. 空闲阶段循环轮询收件箱和任务看板。

```ts
async function idlePoll(name: string, messages: MessageParam[]): Promise<boolean> {
  for (let poll = 0; poll < IDLE_TIMEOUT / POLL_INTERVAL; poll += 1) {
    await sleep(POLL_INTERVAL);

    const inbox = BUS.readInbox(name);
    if (inbox !== "[]") {
      messages.push({ role: "user", content: `<inbox>${inbox}</inbox>` });
      return true;
    }

    const unclaimed = scanUnclaimedTasks();
    if (unclaimed.length > 0) {
      claimTask(unclaimed[0].id, name);
      messages.push({
        role: "user",
        content: `<auto-claimed>Task #${unclaimed[0].id}: ${unclaimed[0].subject}</auto-claimed>`,
      });
      return true;
    }
  }

  return false;
}
```

3. 任务看板扫描: 找 pending 状态、无 owner、未被阻塞的任务。

```ts
function scanUnclaimedTasks(): TaskRecord[] {
  return listTaskFiles(TASKS_DIR)
    .map((file) => JSON.parse(fs.readFileSync(file, "utf8")) as TaskRecord)
    .filter(
      (task) =>
        task.status === "pending" &&
        !task.owner &&
        task.blockedBy.length === 0,
    );
}
```

4. 身份重注入: 上下文过短 (说明发生了压缩) 时, 在开头插入身份块。

```ts
if (messages.length <= 3) {
  messages.unshift({
    role: "assistant",
    content: `I am ${name}. Continuing.`,
  });
  messages.unshift({
    role: "user",
    content: `<identity>You are "${name}", role: ${role}, team: ${teamName}. Continue your work.</identity>`,
  });
}
```

## 相对 s10 的变更

| 组件           | 之前 (s10)       | 之后 (s11)                       |
|----------------|------------------|----------------------------------|
| Tools          | 12               | 14 (+idle, +claim_task)          |
| 自治性         | 领导指派         | 自组织                           |
| 空闲阶段       | 无               | 轮询收件箱 + 任务看板            |
| 任务认领       | 仅手动           | 自动认领未分配任务               |
| 身份           | 系统提示         | + 压缩后重注入                   |
| 超时           | 无               | 60 秒空闲 -> 自动关机            |

## 试一试

```sh
cd learn-claude-code
npm run s11
```

试试这些 prompt (英文 prompt 对 LLM 效果更好, 也可以用中文):

1. `Create 3 tasks on the board, then spawn alice and bob. Watch them auto-claim.`
2. `Spawn a coder teammate and let it find work from the task board itself`
3. `Create tasks with dependencies. Watch teammates respect the blocked order.`
4. 输入 `/tasks` 查看带 owner 的任务看板
5. 输入 `/team` 监控谁在工作、谁在空闲
