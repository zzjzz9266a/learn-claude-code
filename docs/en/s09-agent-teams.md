# s09: Agent Teams

`s01 > s02 > s03 > s04 > s05 > s06 | s07 > s08 > [ s09 ] s10 > s11 > s12`

> *"When the task is too big for one, delegate to teammates"* -- persistent teammates + async mailboxes.
>
> **Harness layer**: Team mailboxes -- multiple models, coordinated through files.

## Problem

Subagents (s04) are disposable: spawn, work, return summary, die. No identity, no memory between invocations. Background tasks (s08) run shell commands but can't make LLM-guided decisions.

Real teamwork needs: (1) persistent agents that outlive a single prompt, (2) identity and lifecycle management, (3) a communication channel between agents.

## Solution

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

## How It Works

1. TeammateManager maintains config.json with the team roster.

```ts
const teammates: Array<{ name: string; role: string; status: string }> = [];
```

2. `spawn()` creates a teammate and starts its agent loop in a thread.

```ts
spawn_teammate: ({ name, role }: { name: string; role: string }) => {
  teammates.push({ name, role, status: "working" });
  return `Spawned '${name}' (role: ${role})`;
},
```

3. MessageBus: append-only JSONL inboxes. `send()` appends a JSON line; `read_inbox()` reads all and drains.

```ts
class MessageBus {
  send(sender: string, to: string, content: string, msgType = "message") {
    appendFileSync(join(this.inboxDir, `${to}.jsonl`), JSON.stringify({
      type: msgType,
      from: sender,
      content,
      timestamp: Date.now() / 1000,
    }) + "\n");
  }

  readInbox(name: string) {
    const path = join(this.inboxDir, `${name}.jsonl`);
    if (!existsSync(path)) return [];
    const messages = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
    writeFileSync(path, "");
    return messages;
  }
}
```

4. Each teammate checks its inbox before every LLM call, injecting received messages into context.

```ts
const handlers = {
  send_message: ({ to, content, msg_type }: any) => bus.send("lead", to, content, msg_type),
  read_inbox: () => JSON.stringify(bus.readInbox("lead"), null, 2),
  list_teammates: () =>
    teammates.length === 0
      ? "No teammates."
      : teammates.map((member) => `${member.name} (${member.role}): ${member.status}`).join("\n"),
};
```

## What Changed From s08

| Component      | Before (s08)     | After (s09)                |
|----------------|------------------|----------------------------|
| Tools          | 6                | 9 (+spawn/send/read_inbox) |
| Agents         | Single           | Lead + N teammates         |
| Persistence    | None             | config.json + JSONL inboxes|
| Threads        | Background cmds  | Full agent loops per thread|
| Lifecycle      | Fire-and-forget  | idle -> working -> idle    |
| Communication  | None             | message + broadcast        |

## Try It

```sh
cd learn-claude-code
npm run s09
```

1. `Spawn alice (coder) and bob (tester). Have alice send bob a message.`
2. `Broadcast "status update: phase 1 complete" to all teammates`
3. `Check the lead inbox for any messages`
4. Type `/team` to see the team roster with statuses
5. Type `/inbox` to manually check the lead's inbox
