# s08: Background Tasks (后台任务)

`s01 > s02 > s03 > s04 > s05 > s06 | s07 > [ s08 ] s09 > s10 > s11 > s12`

> *"慢操作丢后台, agent 继续想下一步"* -- 后台任务跑命令, 完成后注入通知。
>
> **Harness 层**: 后台执行 -- 模型继续思考, harness 负责等待。

## 问题

有些命令要跑好几分钟: `npm install`、`npm test`、`docker build`。阻塞式循环下模型只能干等。用户说 "装依赖, 顺便建个配置文件", Agent 却只能一个一个来。

## 解决方案

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

## 工作原理

1. BackgroundManager 用任务表和通知队列追踪后台执行。

```ts
class BackgroundManager {
  private tasks = new Map<string, BackgroundTask>();
  private notifications: BackgroundNotification[] = [];
}
```

2. `run()` 启动守护线程, 立即返回。

```ts
run(command: string): string {
  const taskId = crypto.randomUUID().slice(0, 8);
  this.tasks.set(taskId, { status: "running", command });

  void this.execute(taskId, command);
  return `Background task ${taskId} started`;
}
```

3. 子进程完成后, 结果进入通知队列。

```ts
private async execute(taskId: string, command: string) {
  const result = await runBash(command, { cwd: WORKDIR, timeoutMs: 300_000 });
  this.notifications.push({
    taskId,
    result: result.slice(0, 500),
  });
}
```

4. 每次 LLM 调用前排空通知队列。

```ts
async function agentLoop(messages: MessageParam[]) {
  while (true) {
    const notifications = BG.drainNotifications();
    if (notifications.length > 0) {
      const notifText = notifications
        .map((notification) => `[bg:${notification.taskId}] ${notification.result}`)
        .join("\n");
      messages.push({
        role: "user",
        content: `<background-results>\n${notifText}\n</background-results>`,
      });
    }

    const response = await client.messages.create(/* ... */);
  }
}
```

循环保持单线程。只有子进程 I/O 被并行化。

## 相对 s07 的变更

| 组件           | 之前 (s07)       | 之后 (s08)                         |
|----------------|------------------|------------------------------------|
| Tools          | 8                | 6 (基础 + background_run + check)  |
| 执行方式       | 仅阻塞           | 阻塞 + 后台任务                    |
| 通知机制       | 无               | 每轮排空的队列                     |
| 并发           | 无               | 异步后台执行                       |

## 试一试

```sh
cd learn-claude-code
npm run s08
```

试试这些 prompt (英文 prompt 对 LLM 效果更好, 也可以用中文):

1. `Run "sleep 5 && echo done" in the background, then create a file while it runs`
2. `Start 3 background tasks: "sleep 2", "sleep 4", "sleep 6". Check their status.`
3. `Run npm test in the background and keep working on other things`
