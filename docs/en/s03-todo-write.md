# s03: TodoWrite

`s01 > s02 > [ s03 ] s04 > s05 > s06 | s07 > s08 > s09 > s10 > s11 > s12`

> *"An agent without a plan drifts"* -- list the steps first, then execute.
>
> **Harness layer**: Planning -- keeping the model on course without scripting the route.

## Problem

On multi-step tasks, the model loses track. It repeats work, skips steps, or wanders off. Long conversations make this worse -- the system prompt fades as tool results fill the context. A 10-step refactoring might complete steps 1-3, then the model starts improvising because it forgot steps 4-10.

## Solution

```
+--------+      +-------+      +---------+
|  User  | ---> |  LLM  | ---> | Tools   |
| prompt |      |       |      | + todo  |
+--------+      +---+---+      +----+----+
                    ^                |
                    |   tool_result  |
                    +----------------+
                          |
              +-----------+-----------+
              | TodoManager state     |
              | [ ] task A            |
              | [>] task B  <- doing  |
              | [x] task C            |
              +-----------------------+
                          |
              if rounds_since_todo >= 3:
                inject <reminder> into tool_result
```

## How It Works

1. TodoManager stores items with statuses. Only one item can be `in_progress` at a time.

```ts
class TodoManager {
  items: Array<{ content: string; status: string; activeForm: string }> = [];

  update(items: Array<{ content?: string; status?: string; activeForm?: string }>) {
    let inProgress = 0;
    const normalized = items.map((item, index) => {
      const content = String(item.content ?? "").trim();
      const status = String(item.status ?? "pending").toLowerCase();
      const activeForm = String(item.activeForm ?? "").trim();
      if (!content) throw new Error(`Item ${index}: content required`);
      if (status === "in_progress") inProgress += 1;
      return { content, status, activeForm };
    });

    if (inProgress > 1) throw new Error("Only one in_progress allowed");
    this.items = normalized;
    return this.render();
  }
}
```

2. The `todo` tool goes into the dispatch map like any other tool.

```ts
const handlers = {
  // ...base tools...
  todo: ({ items }: { items: unknown[] }) => todo.update(items as any[]),
};
```

3. A nag reminder injects a nudge if the model goes 3+ rounds without calling `todo`.

```ts
roundsWithoutTodo = usedTodo ? 0 : roundsWithoutTodo + 1;
if (todo.hasOpenItems() && roundsWithoutTodo >= 3) {
  results.push({
    type: "text",
    text: "<reminder>Update your todos.</reminder>",
  });
}
```

The "one in_progress at a time" constraint forces sequential focus. The nag reminder creates accountability.

## What Changed From s02

| Component      | Before (s02)     | After (s03)                |
|----------------|------------------|----------------------------|
| Tools          | 4                | 5 (+todo)                  |
| Planning       | None             | TodoManager with statuses  |
| Nag injection  | None             | `<reminder>` after 3 rounds |
| Agent loop     | Simple dispatch  | + rounds_since_todo counter|

## Try It

```sh
cd learn-claude-code
npm run s03
```

1. `Refactor the file hello.ts: add type hints, docstrings, and a main guard`
2. `Create a TypeScript module set with index.ts, utils.ts, and tests/test_utils.ts`
3. `Review all TypeScript files and fix any style issues`
