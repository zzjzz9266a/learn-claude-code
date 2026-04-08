# s11: Autonomous Agents

`s01 > s02 > s03 > s04 > s05 > s06 | s07 > s08 > s09 > s10 > [ s11 ] s12`

> *"チームメイトが自らボードを見て、仕事を取る"* -- リーダーが逐一割り振る必要はない。
>
> **Harness 層**: 自律 -- 指示なしで仕事を見つけるモデル。

## 問題

s09-s10では、チームメイトは明示的に指示された時のみ作業する。リーダーは各チームメイトを特定のプロンプトでspawnしなければならない。タスクボードに未割り当てのタスクが10個あっても、リーダーが手動で各タスクを割り当てる。これはスケールしない。

真の自律性とは、チームメイトが自分で作業を見つけること: タスクボードをスキャンし、未確保のタスクを確保し、作業し、完了したら次を探す。

もう1つの問題: コンテキスト圧縮(s06)後にエージェントが自分の正体を忘れる可能性がある。アイデンティティ再注入がこれを解決する。

## 解決策

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

## 仕組み

1. チームメイトのループはWORKとIDLEの2フェーズ。LLMがツール呼び出しを止めた時(または`idle`ツールを呼んだ時)、IDLEフェーズに入る。

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

2. IDLEフェーズがインボックスとタスクボードをポーリングする。

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

3. タスクボードスキャン: pendingかつ未割り当てかつブロックされていないタスクを探す。

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

4. アイデンティティ再注入: コンテキストが短すぎる(圧縮が起きた)場合にアイデンティティブロックを挿入する。

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

## s10からの変更点

| Component      | Before (s10)     | After (s11)                |
|----------------|------------------|----------------------------|
| Tools          | 12               | 14 (+idle, +claim_task)    |
| Autonomy       | Lead-directed    | Self-organizing            |
| Idle phase     | None             | Poll inbox + task board    |
| Task claiming  | Manual only      | Auto-claim unclaimed tasks |
| Identity       | System prompt    | + re-injection after compress|
| Timeout        | None             | 60s idle -> auto shutdown  |

## 試してみる

```sh
cd learn-claude-code
npm run s11
```

1. `Create 3 tasks on the board, then spawn alice and bob. Watch them auto-claim.`
2. `Spawn a coder teammate and let it find work from the task board itself`
3. `Create tasks with dependencies. Watch teammates respect the blocked order.`
4. `/tasks`と入力してオーナー付きのタスクボードを確認する
5. `/team`と入力して誰が作業中でアイドルかを監視する
