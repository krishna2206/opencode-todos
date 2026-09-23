// The todo model: types, validation, and how a `todowrite` call turns into the
// next stored list. Pure, so both the server and the tests use it directly.

export const STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
export type TodoStatus = (typeof STATUSES)[number];

export const PRIORITIES = ["high", "medium", "low"] as const;
export type TodoPriority = (typeof PRIORITIES)[number];

/** One item as the model sends it. */
export interface TodoInput {
  id?: string;
  content: string;
  status: TodoStatus;
  priority?: TodoPriority;
}

/** One stored item. `completedAt` is set when the item first reaches `completed`. */
export interface Todo {
  id: string;
  content: string;
  status: TodoStatus;
  priority?: TodoPriority;
  createdAt: number;
  completedAt?: number;
}

/** A session's list. `revision` grows with every write, so readers can tell a change. */
export interface TodoList {
  revision: number;
  updatedAt: number;
  todos: Todo[];
}

export const EMPTY_LIST: TodoList = { revision: 0, updatedAt: 0, todos: [] };

/** Throws with a message meant for the model when the input is not a usable list. */
export function validate(todos: readonly TodoInput[]): void {
  todos.forEach((todo, index) => {
    if (!todo.content.trim()) throw new Error(`todo ${index + 1} has empty content`);
  });
}

/**
 * The next stored list for a full-list write. Each item keeps its identity
 * across calls: by the `id` the model echoed back, else by identical content
 * among the previous items. That identity is what lets the TUI animate the
 * item that just completed rather than guess it.
 */
export function applyWrite(previous: TodoList, input: readonly TodoInput[], now: number): TodoList {
  const byId = new Map(previous.todos.map((todo) => [todo.id, todo]));
  const byContent = new Map(previous.todos.map((todo) => [todo.content.trim(), todo]));
  const claimed = new Set<string>();
  let counter = 0;

  const todos = input.map((item): Todo => {
    const content = item.content.trim();
    const match =
      (item.id && !claimed.has(item.id) ? byId.get(item.id) : undefined) ??
      (() => {
        const candidate = byContent.get(content);
        return candidate && !claimed.has(candidate.id) ? candidate : undefined;
      })();
    const id = match?.id ?? item.id ?? `t${now.toString(36)}${(counter++).toString(36)}`;
    claimed.add(id);
    const completedAt =
      item.status === "completed" ? (match?.status === "completed" ? match.completedAt : undefined) ?? now : undefined;
    return {
      id,
      content,
      status: item.status,
      ...(item.priority ? { priority: item.priority } : {}),
      createdAt: match?.createdAt ?? now,
      ...(completedAt !== undefined ? { completedAt } : {}),
    };
  });

  return { revision: previous.revision + 1, updatedAt: now, todos };
}

const MARKER: Record<TodoStatus, string> = {
  pending: "[ ]",
  in_progress: "[~]",
  completed: "[x]",
  cancelled: "[-]",
};

/** Compact rendering of the list for the model: one line per item, with its id. */
export function renderForModel(list: TodoList): string {
  if (list.todos.length === 0) return "(no todos)";
  const done = list.todos.filter((todo) => todo.status === "completed").length;
  const lines = list.todos.map((todo) => `${MARKER[todo.status]} ${todo.content} (id: ${todo.id})`);
  return [...lines, "", `${done}/${list.todos.length} completed`].join("\n");
}

/** A list still worth tracking: something left to do. */
export function isOpen(list: TodoList): boolean {
  return list.todos.some((todo) => todo.status === "pending" || todo.status === "in_progress");
}
