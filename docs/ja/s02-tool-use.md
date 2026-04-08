# s02: Tool Use

`s01 > [ s02 ] s03 > s04 > s05 > s06 | s07 > s08 > s09 > s10 > s11 > s12`

> *"ツールを足すなら、ハンドラーを1つ足すだけ"* -- ループは変わらない。新ツールは dispatch map に登録するだけ。
>
> **Harness 層**: ツール分配 -- モデルが届く範囲を広げる。

## 問題

`bash`だけでは、エージェントは何でもシェル経由で行う。`cat`は予測不能に切り詰め、`sed`は特殊文字で壊れ、すべてのbash呼び出しが制約のないセキュリティ面になる。`read_file`や`write_file`のような専用ツールなら、ツールレベルでパスのサンドボックス化を強制できる。

重要な点: ツールを追加してもループの変更は不要。

## 解決策

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
1 回の参照で分岐の連鎖を置き換えられる。
```

## 仕組み

1. 各ツールにハンドラ関数を定義する。パスのサンドボックス化でワークスペース外への脱出を防ぐ。

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

2. ディスパッチマップがツール名とハンドラを結びつける。

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

3. ループ内で名前によりハンドラをルックアップする。ループ本体はs01から不変。

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

ツール追加 = ハンドラ追加 + スキーマ追加。ループは決して変わらない。

## s01からの変更点

| Component      | Before (s01)       | After (s02)                |
|----------------|--------------------|----------------------------|
| Tools          | 1 (bash only)      | 4 (bash, read, write, edit)|
| Dispatch       | Hardcoded bash call | `TOOL_HANDLERS` record     |
| Path safety    | None               | `safePath()` sandbox       |
| Agent loop     | Unchanged          | Unchanged                  |

## 試してみる

```sh
cd learn-claude-code
npm run s02
```

1. `Read the file package.json`
2. `Create a file called greet.ts with a greet(name) function`
3. `Edit greet.ts to add a docstring to the function`
4. `Read greet.ts to verify the edit worked`
