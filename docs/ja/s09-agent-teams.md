# s09: Agent Teams

`s01 > s02 > s03 > s04 > s05 > s06 | s07 > s08 > [ s09 ] s10 > s11 > s12`

> *"一人で終わらないなら、チームメイトに任せる"* -- 永続チームメイト + 非同期メールボックス。
>
> **Harness 層**: チームメールボックス -- 複数モデルをファイルで協調。

## 問題

サブエージェント(s04)は使い捨てだ: 生成し、作業し、要約を返し、消滅する。アイデンティティもなく、呼び出し間の記憶もない。バックグラウンドタスク(s08)はシェルコマンドを実行するが、LLM誘導の意思決定はできない。

本物のチームワークには: (1)単一プロンプトを超えて存続する永続エージェント、(2)アイデンティティとライフサイクル管理、(3)エージェント間の通信チャネルが必要だ。

## 解決策

```
Teammate lifecycle:
  spawn -> WORKING -> IDLE -> WORKING -> ... -> SHUTDOWN

Communication:
  .team/
    config.json           <- team roster + statuses
    inbox/
      alice.jsonl         <- append-only, drain-on-read
      bob.jsonl
      lead.jsonl

              +--------+    send("alice","bob","...")    +--------+
              | alice  | -----------------------------> |  bob   |
              | loop   |    bob.jsonl << {json_line}    |  loop  |
              +--------+                                +--------+
                   ^                                         |
                   |        BUS.read_inbox("alice")          |
                   +---- alice.jsonl -> read + drain ---------+
```

## 仕組み

1. TeammateManagerがconfig.jsonでチーム名簿を管理する。

```ts
class TeammateManager {
  constructor(private readonly teamDir: string) {
    fs.mkdirSync(teamDir, { recursive: true });
    this.configPath = path.join(teamDir, "config.json");
    this.config = this.loadConfig();
  }

  private readonly configPath: string;
  private config: TeamConfig;
}
```

2. `spawn()`がチームメイトを作成し、そのエージェントループをスレッドで開始する。

```ts
spawn(name: string, role: string, prompt: string): string {
  this.config.members.push({ name, role, status: "working" });
  this.saveConfig();
  void this.runTeammateLoop(name, role, prompt);
  return `Spawned teammate "${name}" (role: ${role})`;
}
```

3. MessageBus: 追記専用のJSONLインボックス。`send()`がJSON行を追記し、`read_inbox()`がすべて読み取ってドレインする。

```ts
class MessageBus {
  send(
    sender: string,
    to: string,
    content: string,
    type = "message",
    extra: Record<string, unknown> = {},
  ) {
    const message = {
      type,
      from: sender,
      content,
      timestamp: Date.now(),
      ...extra,
    };
    fs.appendFileSync(this.inboxPath(to), `${JSON.stringify(message)}\n`);
  }

  readInbox(name: string): string {
    const inboxPath = this.inboxPath(name);
    if (!fs.existsSync(inboxPath)) return "[]";
    const content = fs.readFileSync(inboxPath, "utf8").trim();
    fs.writeFileSync(inboxPath, "");
    if (!content) return "[]";
    return JSON.stringify(
      content.split("\n").filter(Boolean).map((line) => JSON.parse(line)),
      null,
      2,
    );
  }
}
```

4. 各チームメイトは各LLM呼び出しの前にインボックスを確認し、受信メッセージをコンテキストに注入する。

```ts
async runTeammateLoop(name: string, role: string, prompt: string) {
  const messages: MessageParam[] = [{ role: "user", content: prompt }];

  for (let round = 0; round < 50; round += 1) {
    const inbox = BUS.readInbox(name);
    if (inbox !== "[]") {
      messages.push({ role: "user", content: `<inbox>${inbox}</inbox>` });
    }

    const response = await client.messages.create(/* ... */);
    if (response.stop_reason !== "tool_use") break;

    // execute tools, append results...
  }

  this.findMember(name).status = "idle";
  this.saveConfig();
}
```

## s08からの変更点

| Component      | Before (s08)     | After (s09)                |
|----------------|------------------|----------------------------|
| Tools          | 6                | 9 (+spawn/send/read_inbox) |
| Agents         | Single           | Lead + N teammates         |
| Persistence    | None             | config.json + JSONL inboxes|
| Threads        | Background cmds  | Full agent loops per thread|
| Lifecycle      | Fire-and-forget  | idle -> working -> idle    |
| Communication  | None             | message + broadcast        |

## 試してみる

```sh
cd learn-claude-code
npm run s09
```

1. `Spawn alice (coder) and bob (tester). Have alice send bob a message.`
2. `Broadcast "status update: phase 1 complete" to all teammates`
3. `Check the lead inbox for any messages`
4. `/team`と入力してステータス付きのチーム名簿を確認する
5. `/inbox`と入力してリーダーのインボックスを手動確認する
