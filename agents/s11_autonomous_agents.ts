export { runS09 as runS11 } from "./s09_agent_teams";
import { isMainModule, startRepl } from "../src/core";
import { runS09 } from "./s09_agent_teams";

if (isMainModule(import.meta.url)) {
  await startRepl({ sessionId: "s11", runTurn: runS09 });
}
