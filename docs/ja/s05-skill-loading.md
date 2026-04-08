# s05: Skills

`s01 > s02 > s03 > s04 > [ s05 ] s06 | s07 > s08 > s09 > s10 > s11 > s12`

> *"必要な知識を、必要な時に読み込む"* -- system prompt ではなく tool_result で注入。
>
> **Harness 層**: オンデマンド知識 -- モデルが求めた時だけ渡すドメイン専門性。

## 問題

エージェントにドメイン固有のワークフローを遵守させたい: gitの規約、テストパターン、コードレビューチェックリスト。すべてをシステムプロンプトに入れると、使われないスキルにトークンを浪費する。10スキル x 2000トークン = 20,000トークン、ほとんどが任意のタスクに無関係だ。

## 解決策

```
System prompt (Layer 1 -- always present):
+--------------------------------------+
| You are a coding agent.              |
| Skills available:                    |
|   - git: Git workflow helpers        |  ~100 tokens/skill
|   - test: Testing best practices     |
+--------------------------------------+

When model calls load_skill("git"):
+--------------------------------------+
| tool_result (Layer 2 -- on demand):  |
| <skill name="git">                   |
|   Full git workflow instructions...  |  ~2000 tokens
|   Step 1: ...                        |
| </skill>                             |
+--------------------------------------+
```

第1層: スキル*名*をシステムプロンプトに(低コスト)。第2層: スキル*本体*をtool_resultに(オンデマンド)。

## 仕組み

1. 各スキルは `SKILL.md` ファイルを含むディレクトリとして配置される。

```
skills/
  pdf/
    SKILL.md       # ---\n name: pdf\n description: Process PDF files\n ---\n ...
  code-review/
    SKILL.md       # ---\n name: code-review\n description: Review code\n ---\n ...
```

2. SkillLoaderが `SKILL.md` を再帰的に探索し、ディレクトリ名をスキル識別子として使用する。

```ts
class SkillLoader {
  private skills = new Map<string, { meta: SkillMeta; body: string }>();

  constructor(private readonly skillsDir: string) {
    for (const file of findSkillFiles(skillsDir)) {
      const text = fs.readFileSync(file, "utf8");
      const { meta, body } = parseFrontmatter(text);
      const name = meta.name ?? path.basename(path.dirname(file));
      this.skills.set(name, { meta, body });
    }
  }

  getDescriptions(): string {
    return [...this.skills.entries()]
      .map(([name, skill]) => `  - ${name}: ${skill.meta.description ?? ""}`)
      .join("\n");
  }

  getContent(name: string): string {
    const skill = this.skills.get(name);
    if (!skill) return `Error: Unknown skill "${name}".`;
    return `<skill name="${name}">\n${skill.body}\n</skill>`;
  }
}
```

3. 第1層はシステムプロンプトに配置。第2層は通常のツールハンドラ。

```ts
const SYSTEM = `You are a coding agent at ${WORKDIR}.
Skills available:
${SKILL_LOADER.getDescriptions()}`;

const TOOL_HANDLERS = {
  ...BASE_TOOL_HANDLERS,
  load_skill: ({ name }: { name: string }) => SKILL_LOADER.getContent(name),
};
```

モデルはどのスキルが存在するかを知り(低コスト)、関連する時にだけ読み込む(高コスト)。

## s04からの変更点

| Component      | Before (s04)     | After (s05)                |
|----------------|------------------|----------------------------|
| Tools          | 5 (base + task)  | 5 (base + load_skill)      |
| System prompt  | Static string    | + skill descriptions       |
| Knowledge      | None             | skills/\*/SKILL.md files   |
| Injection      | None             | Two-layer (system + result)|

## 試してみる

```sh
cd learn-claude-code
npm run s05
```

1. `What skills are available?`
2. `Load the agent-builder skill and follow its instructions`
3. `I need to do a code review -- load the relevant skill first`
4. `Build an MCP server using the mcp-builder skill`
