import type { Message } from "./reference-agent";
import { extractText } from "./reference-agent";

export function isMainModule(metaUrl: string) {
  const entry = process.argv[1];
  if (!entry) return false;
  return new URL(metaUrl).pathname === entry;
}

export async function startRepl(options: {
  sessionId: string;
  runTurn: (history: Message[]) => Promise<void>;
}) {
  const history: Message[] = [];
  process.stdin.setEncoding("utf8");
  while (true) {
    const prompt = await readLine(`\u001b[36m${options.sessionId} >> \u001b[0m`);
    const query = prompt.trim();
    if (!query || query.toLowerCase() === "q" || query.toLowerCase() === "exit") {
      break;
    }
    history.push({ role: "user", content: query });
    await options.runTurn(history);
    const last = history.at(-1);
    if (last && Array.isArray(last.content)) {
      const text = extractText(last.content as any[]);
      if (text) console.log(text);
    }
    console.log();
  }
}

function readLine(prompt: string) {
  return new Promise<string>((resolve) => {
    process.stdout.write(prompt);
    process.stdin.resume();
    process.stdin.once("data", (chunk) => {
      process.stdin.pause();
      resolve(String(chunk));
    });
  });
}
