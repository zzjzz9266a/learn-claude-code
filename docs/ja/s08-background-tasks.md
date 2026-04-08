# s08: Background Tasks

`s01 > s02 > s03 > s04 > s05 > s06 | s07 > [ s08 ] s09 > s10 > s11 > s12`

> *"遅い操作はバックグラウンドへ、エージェントは次を考え続ける"* -- バックグラウンドタスクがコマンド実行し、完了後に通知を注入する。
>
> **Harness 層**: バックグラウンド実行 -- モデルが考え続ける間、Harness が待つ。

## 問題

一部のコマンドは数分かかる: `npm install`、`npm test`、`docker build`。ブロッキングループでは、モデルはサブプロセスの完了を待って座っている。ユーザーが「依存関係をインストールして、その間にconfigファイルを作って」と言っても、エージェントは並列ではなく逐次的に処理する。

## 解決策

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

## 仕組み

1. BackgroundManagerがタスク表と通知キューでバックグラウンド実行を追跡する。

```ts
class BackgroundManager {
  private tasks = new Map<string, BackgroundTask>();
  private notifications: BackgroundNotification[] = [];
}
```

2. `run()`がデーモンスレッドを開始し、即座にリターンする。

```ts
run(command: string): string {
  const taskId = crypto.randomUUID().slice(0, 8);
  this.tasks.set(taskId, { status: "running", command });

  void this.execute(taskId, command);
  return `Background task ${taskId} started`;
}
```

3. サブプロセス完了時に、結果を通知キューへ。

```ts
private async execute(taskId: string, command: string) {
  const result = await runBash(command, { cwd: WORKDIR, timeoutMs: 300_000 });
  this.notifications.push({
    taskId,
    result: result.slice(0, 500),
  });
}
```

4. エージェントループが各LLM呼び出しの前に通知をドレインする。

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

ループはシングルスレッドのまま。サブプロセスI/Oだけが並列化される。

## s07からの変更点

| Component      | Before (s07)     | After (s08)                |
|----------------|------------------|----------------------------|
| Tools          | 8                | 6 (base + background_run + check)|
| Execution      | Blocking only    | Blocking + background tasks  |
| Notification   | None             | Queue drained per loop     |
| Concurrency    | None             | Async background work      |

## 試してみる

```sh
cd learn-claude-code
npm run s08
```

1. `Run "sleep 5 && echo done" in the background, then create a file while it runs`
2. `Start 3 background tasks: "sleep 2", "sleep 4", "sleep 6". Check their status.`
3. `Run npm test in the background and keep working on other things`
