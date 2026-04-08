# s02: Tool Use

`s01 > [ s02 ] s03 > s04 > s05 > s06 | s07 > s08 > s09 > s10 > s11 > s12`

> *"Adding a tool means adding one handler"* -- the loop stays the same; new tools register into the dispatch map.
>
> **Harness layer**: Tool dispatch -- expanding what the model can reach.

## Problem

With only `bash`, the agent shells out for everything. `cat` truncates unpredictably, `sed` fails on special characters, and every bash call is an unconstrained security surface. Dedicated tools like `read_file` and `write_file` let you enforce path sandboxing at the tool level.

The key insight: adding tools does not require changing the loop.

## Solution

```
+--------+      +-------+      +------------------+
|  User  | ---> |  LLM  | ---> | Tool Dispatch    |
| prompt |      |       |      | {                |
+--------+      +---+---+      |   bash: run_bash |
                    ^           |   read: run_read |
                    |           |   write: run_wr  |
                    +-----------+   edit: run_edit |
                    tool_result | }                |
                                +------------------+

The dispatch map is a record: `{toolName: handler}`.
One lookup replaces any branching chain.
```

## How It Works

1. Each tool gets a handler function. Path sandboxing prevents workspace escape.

```ts
function safePath(relativePath: string): string {
  const resolved = path.resolve(WORKDIR, relativePath);
  if (!resolved.startsWith(`${WORKDIR}${path.sep}`) && resolved !== WORKDIR) {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }
  return resolved;
}

function runRead(filePath: string, limit?: number): string {
  const text = fs.readFileSync(safePath(filePath), "utf8");
  const lines = text.split("\n");
  const visible = typeof limit === "number" ? lines.slice(0, limit) : lines;
  return visible.join("\n").slice(0, 50_000);
}
```

2. The dispatch map links tool names to handlers.

```ts
const TOOL_HANDLERS = {
  bash: ({ command }: { command: string }) => runBash(command),
  read_file: ({ path, limit }: { path: string; limit?: number }) =>
    runRead(path, limit),
  write_file: ({ path, content }: { path: string; content: string }) =>
    runWrite(path, content),
  edit_file: ({
    path,
    old_text,
    new_text,
  }: {
    path: string;
    old_text: string;
    new_text: string;
  }) => runEdit(path, old_text, new_text),
};
```

3. In the loop, look up the handler by name. The loop body itself is unchanged from s01.

```ts
for (const block of response.content) {
  if (block.type !== "tool_use") continue;
  const handler = TOOL_HANDLERS[block.name as keyof typeof TOOL_HANDLERS];
  const output = handler
    ? await handler(block.input as never)
    : `Unknown tool: ${block.name}`;

  results.push({
    type: "tool_result",
    tool_use_id: block.id,
    content: output,
  });
}
```

Add a tool = add a handler + add a schema entry. The loop never changes.

## What Changed From s01

| Component      | Before (s01)       | After (s02)                |
|----------------|--------------------|----------------------------|
| Tools          | 1 (bash only)      | 4 (bash, read, write, edit)|
| Dispatch       | Hardcoded bash call | `TOOL_HANDLERS` record     |
| Path safety    | None               | `safePath()` sandbox       |
| Agent loop     | Unchanged          | Unchanged                  |

## Try It

```sh
cd learn-claude-code
npm run s02
```

1. `Read the file package.json`
2. `Create a file called greet.ts with a greet(name) function`
3. `Edit greet.ts to add a docstring to the function`
4. `Read greet.ts to verify the edit worked`
