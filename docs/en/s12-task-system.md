# s12: Task System

`s01 > s02 > s03 > s04 > s05 > s06 > s07 > s08 > s09 > s10 > s11 > [ s12 ] > s13 > s14 > s15 > s16 > s17 > s18 > s19`

## What You'll Learn

- How to promote a flat checklist into a task graph with explicit dependencies
- How `blockedBy` and `blocks` edges express ordering and parallelism
- How status transitions (`pending` -> `in_progress` -> `completed`) drive automatic unblocking
- How persisting tasks to disk makes them survive compression and restarts

Back in s03 you gave the agent a TodoWrite tool -- a flat checklist that tracks what is done and what is not. That works well for a single focused session. But real work has structure. Task B depends on task A. Tasks C and D can run in parallel. Task E waits for both C and D. A flat list cannot express any of that. And because the checklist lives only in memory, context compression (s06) wipes it clean. In this chapter you will replace the checklist with a proper task graph that understands dependencies, persists to disk, and becomes the coordination backbone for everything that follows.

## The Problem

Imagine you ask your agent to refactor a codebase: parse the AST, transform the nodes, emit the new code, and run the tests. The parse step must finish before transform and emit can begin. Transform and emit can run in parallel. Tests must wait for both. With s03's flat TodoWrite, the agent has no way to express these relationships. It might attempt the transform before the parse is done, or run the tests before anything is ready. There is no ordering, no dependency tracking, and no status beyond "done or not." Worse, if the context window fills up and compression kicks in, the entire plan vanishes.

## The Solution

Promote the checklist into a task graph persisted to disk. Each task is a JSON file with status, dependencies (`blockedBy`), and dependents (`blocks`). The graph answers three questions at any moment: what is ready, what is blocked, and what is done.

```
.tasks/
  task_1.json  {"id":1, "status":"completed"}
  task_2.json  {"id":2, "blockedBy":[1], "status":"pending"}
  task_3.json  {"id":3, "blockedBy":[1], "status":"pending"}
  task_4.json  {"id":4, "blockedBy":[2,3], "status":"pending"}

Task graph (DAG):
                 +----------+
            +--> | task 2   | --+
            |    | pending  |   |
+----------+     +----------+    +--> +----------+
| task 1   |                          | task 4   |
| completed| --> +----------+    +--> | blocked  |
+----------+     | task 3   | --+     +----------+
                 | pending  |
                 +----------+

Ordering:     task 1 must finish before 2 and 3
Parallelism:  tasks 2 and 3 can run at the same time
Dependencies: task 4 waits for both 2 and 3
Status:       pending -> in_progress -> completed
```

The structure above is a DAG -- a directed acyclic graph, meaning tasks flow forward and never loop back. This task graph becomes the coordination backbone for the later chapters: background execution (s13), agent teams (s15+), and worktree isolation (s18) all build on the same durable task structure.

## How It Works

**Step 1.** Create a `TaskManager` that stores one JSON file per task, with CRUD operations and a dependency graph.

```typescript
class TaskManager {
  private dir: Path;
  private nextId: number;

  constructor(tasksDir: Path) {
    this.dir = tasksDir;
    this.dir.mkdir({ exist_ok: true });
    this.nextId = this._maxId() + 1;
  }

  create(subject: string, description?: string): string {
    const task = {
      id: this.nextId,
      subject: subject,
      status: "pending",
      blockedBy: [],
      blocks: [],
      owner: ""
    };
    this._save(task);
    this.nextId++;
    return JSON.stringify(task, null, 2);
  }
}
```

**Step 2.** Implement dependency resolution. When a task completes, clear its ID from every other task's `blockedBy` list, automatically unblocking dependents.

```typescript
_clearDependency(completedId: number): void {
  for (const f of this.dir.glob("task_*.json")) {
    const task = JSON.parse(f.readText());
    if (task.blockedBy?.includes(completedId)) {
      task.blockedBy = task.blockedBy.filter(id => id !== completedId);
      this._save(task);
    }
  }
}
```

**Step 3.** Wire up status transitions and dependency edges in the `update` method. When a task's status changes to `completed`, the dependency-clearing logic from Step 2 fires automatically.

```typescript
update(taskId: number, status?: string, addBlockedBy?: number[], addBlocks?: number[]): void {
  const task = this._load(taskId);
  if (status) {
    task.status = status;
    if (status === "completed") {
      this._clearDependency(taskId);
    }
  }
  this._save(task);
}
```

**Step 4.** Register four task tools in the dispatch map, giving the agent full control over creating, updating, listing, and inspecting tasks.

```typescript
const TOOL_HANDLERS = {
  // ...base tools...
  "task_create": (kw: any) => TASKS.create(kw["subject"]),
  "task_update": (kw: any) => TASKS.update(kw["task_id"], kw["status"]),
  "task_list":   (kw: any) => TASKS.listAll(),
  "task_get":    (kw: any) => TASKS.get(kw["task_id"]),
};
```

From s12 onward, the task graph becomes the default for durable multi-step work. s03's Todo remains useful for quick single-session checklists, but anything that needs ordering, parallelism, or persistence belongs here.

## Read Together

- If you are coming straight from s03, revisit [`data-structures.md`](./data-structures.md) to separate `TodoItem` / `PlanState` from `TaskRecord` -- they look similar but serve different purposes.
- If object boundaries start to blur, reset with [`entity-map.md`](./entity-map.md) before you mix messages, tasks, runtime tasks, and teammates into one layer.
- If you plan to continue into s13, keep [`s13a-runtime-task-model.md`](./s13a-runtime-task-model.md) beside this chapter because durable tasks and runtime tasks are the easiest pair to confuse next.

## What Changed

| Component | Before (s06) | After (s12) |
|---|---|---|
| Tools | 5 | 8 (`task_create/update/list/get`) |
| Planning model | Flat checklist (in-memory) | Task graph with dependencies (on disk) |
| Relationships | None | `blockedBy` + `blocks` edges |
| Status tracking | Done or not | `pending` -> `in_progress` -> `completed` |
| Persistence | Lost on compression | Survives compression and restarts |

## Try It

```sh
cd learn-claude-code
tsx agents/s12_task_system.ts
```

1. `Create 3 tasks: "Setup project", "Write code", "Write tests". Make them depend on each other in order.`
2. `List all tasks and show the dependency graph`
3. `Complete task 1 and then list tasks to see task 2 unblocked`
4. `Create a task board for refactoring: parse -> transform -> emit -> test, where transform and emit can run in parallel after parse`

## What You've Mastered

At this point, you can:

- Build a file-based task graph where each task is a self-contained JSON record
- Express ordering and parallelism through `blockedBy` and `blocks` dependency edges
- Implement automatic unblocking when upstream tasks complete
- Persist planning state so it survives context compression and process restarts

## What's Next

Tasks now have structure and live on disk. But every tool call still blocks the main loop -- if a task involves a slow subprocess like `npm install` or `pytest`, the agent sits idle waiting. In s13 you will add background execution so slow work runs in parallel while the agent keeps thinking.

## Key Takeaway

> A task graph with explicit dependencies turns a flat checklist into a coordination structure that knows what is ready, what is blocked, and what can run in parallel.
