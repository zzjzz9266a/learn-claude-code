# s02: Tool Use (工具使用)

`s01 > [ s02 ] s03 > s04 > s05 > s06 | s07 > s08 > s09 > s10 > s11 > s12`

> *"加一个工具, 只加一个 handler"* -- 循环不用动, 新工具注册进 dispatch map 就行。
>
> **Harness 层**: 工具分发 -- 扩展模型能触达的边界。

## 问题

只有 `bash` 时, 所有操作都走 shell。`cat` 截断不可预测, `sed` 遇到特殊字符就崩, 每次 bash 调用都是不受约束的安全面。专用工具 (`read_file`, `write_file`) 可以在工具层面做路径沙箱。

关键洞察: 加工具不需要改循环。

## 解决方案

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

The dispatch map is a record: `{toolName: handler}`。
一次查表替代整串分支判断。
```

## 工作原理

1. 每个工具有一个处理函数。路径沙箱防止逃逸工作区。

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

2. dispatch map 将工具名映射到处理函数。

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

3. 循环中按名称查找处理函数。循环体本身与 s01 完全一致。

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

加工具 = 加 handler + 加 schema。循环永远不变。

## 相对 s01 的变更

| 组件           | 之前 (s01)         | 之后 (s02)                     |
|----------------|--------------------|--------------------------------|
| Tools          | 1 (仅 bash)        | 4 (bash, read, write, edit)    |
| Dispatch       | 硬编码 bash 调用   | `TOOL_HANDLERS` 记录表         |
| 路径安全       | 无                 | `safePath()` 沙箱              |
| Agent loop     | 不变               | 不变                           |

## 试一试

```sh
cd learn-claude-code
npm run s02
```

试试这些 prompt (英文 prompt 对 LLM 效果更好, 也可以用中文):

1. `Read the file package.json`
2. `Create a file called greet.ts with a greet(name) function`
3. `Edit greet.ts to add a docstring to the function`
4. `Read greet.ts to verify the edit worked`
