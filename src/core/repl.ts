import { fileURLToPath } from "node:url";

import type { Message } from "./reference-agent";
import { extractText } from "./reference-agent";

function normalizeComparablePath(input: string) {
  const normalized = input.replaceAll("\\", "/");
  if (/^\/[A-Za-z]:\//.test(normalized)) {
    return normalized.slice(1).toLowerCase();
  }
  if (/^[A-Za-z]:\//.test(normalized)) {
    return normalized.toLowerCase();
  }
  return normalized;
}

export function isMainModule(metaUrl: string) {
  const entry = process.argv[1];
  if (!entry) return false;
  return normalizeComparablePath(fileURLToPath(metaUrl)) === normalizeComparablePath(entry);
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
