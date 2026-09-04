interface TasksProject {
  id: string;
  linkedBbProjectId: string | null;
}

export interface TaskSummary {
  id: string;
  key: string;
  status: string;
  projectId: string;
}

export interface TaskSnapshot {
  task: TaskSummary;
  linkedBbProjectId: string | null;
}

interface RpcEnvelope {
  ok: boolean;
  result?: unknown;
  error?: unknown;
}

const TASKS_PLUGIN_ID = "tasks";
const POLL_INTERVAL_MS = 4_000;
const MAX_PAGES_PER_PROJECT = 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function callTasksRpc(
  loopbackBaseUrl: string,
  method: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(
    `${loopbackBaseUrl}/api/v1/plugins/${TASKS_PLUGIN_ID}/rpc/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal,
    },
  );
  if (!response.ok) throw new Error(`Tasks RPC ${method} returned ${response.status}`);
  const envelope = (await response.json()) as RpcEnvelope;
  if (!isRecord(envelope) || envelope.ok !== true || !("result" in envelope)) {
    throw new Error(`Tasks RPC ${method} failed`);
  }
  return envelope.result;
}

function parseProjects(value: unknown): TasksProject[] {
  if (!isRecord(value) || !Array.isArray(value.projects)) return [];
  return value.projects.flatMap((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      (candidate.linkedBbProjectId !== null &&
        typeof candidate.linkedBbProjectId !== "string")
    ) {
      return [];
    }
    return [
      {
        id: candidate.id,
        linkedBbProjectId: candidate.linkedBbProjectId,
      },
    ];
  });
}

function parseTaskPage(value: unknown): {
  tasks: TaskSummary[];
  nextCursor: string | null;
} {
  if (!isRecord(value) || !Array.isArray(value.tasks)) {
    throw new Error("Tasks RPC returned an invalid task page");
  }
  const tasks = value.tasks.flatMap((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      typeof candidate.key !== "string" ||
      typeof candidate.status !== "string" ||
      typeof candidate.projectId !== "string"
    ) {
      return [];
    }
    return [
      {
        id: candidate.id,
        key: candidate.key,
        status: candidate.status,
        projectId: candidate.projectId,
      },
    ];
  });
  return {
    tasks,
    nextCursor: typeof value.nextCursor === "string" ? value.nextCursor : null,
  };
}

async function readSnapshot(
  loopbackBaseUrl: string,
  signal: AbortSignal,
): Promise<Map<string, TaskSnapshot>> {
  const projects = parseProjects(
    await callTasksRpc(loopbackBaseUrl, "listProjects", {}, signal),
  );
  const snapshot = new Map<string, TaskSnapshot>();

  for (const project of projects) {
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < MAX_PAGES_PER_PROJECT; pageNumber += 1) {
      const page = parseTaskPage(
        await callTasksRpc(
          loopbackBaseUrl,
          "listTasks",
          {
            projectId: project.id,
            activeOnly: false,
            sort: "manual",
            limit: 500,
            ...(cursor === undefined ? {} : { cursor }),
          },
          signal,
        ),
      );
      for (const task of page.tasks) {
        snapshot.set(task.id, { task, linkedBbProjectId: project.linkedBbProjectId });
      }
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
  }

  return snapshot;
}

function waitForNextPoll(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, POLL_INTERVAL_MS);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export interface CompletedTaskEvent {
  taskKey: string;
  projectId?: string;
}

export function findCompletedTaskEvents(
  previous: ReadonlyMap<string, TaskSnapshot> | null,
  current: ReadonlyMap<string, TaskSnapshot>,
): CompletedTaskEvent[] {
  if (previous === null) return [];
  const completed: CompletedTaskEvent[] = [];
  for (const [taskId, next] of current) {
    const before = previous.get(taskId);
    if (before !== undefined && before.task.status !== "done" && next.task.status === "done") {
      completed.push({
        taskKey: next.task.key,
        ...(next.linkedBbProjectId === null
          ? {}
          : { projectId: next.linkedBbProjectId }),
      });
    }
  }
  return completed;
}

export async function watchTaskCompletions(
  loopbackBaseUrl: string,
  signal: AbortSignal,
  onComplete: (event: CompletedTaskEvent) => void,
): Promise<void> {
  let previous: Map<string, TaskSnapshot> | null = null;

  while (!signal.aborted) {
    try {
      const current = await readSnapshot(loopbackBaseUrl, signal);
      for (const event of findCompletedTaskEvents(previous, current)) onComplete(event);
      previous = current;
    } catch (error) {
      if (signal.aborted) return;
      // Tasks is an optional built-in plugin. Being disabled or temporarily
      // unavailable should not affect the rest of the companion.
    }
    await waitForNextPoll(signal);
  }
}
