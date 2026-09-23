// What the TUI line shows, computed from a list. Pure, so it is tested without
// a renderer.

import type { Todo, TodoList, TodoStatus } from "./todos.js";

export interface LineView {
  /** The item the collapsed line shows: the one in progress, else the next pending. */
  current?: Todo;
  done: number;
  total: number;
  /** Every item is completed or cancelled. */
  finished: boolean;
}

export function lineView(list: TodoList): LineView {
  const todos = list.todos.filter((todo) => todo.status !== "cancelled");
  const done = todos.filter((todo) => todo.status === "completed").length;
  const current =
    list.todos.find((todo) => todo.status === "in_progress") ?? list.todos.find((todo) => todo.status === "pending");
  return { current, done, total: todos.length, finished: todos.length > 0 && !current };
}

/** Items newly completed between two revisions of the same list, by identity. */
export function newlyCompleted(previous: TodoList, next: TodoList): string[] {
  const before = new Map(previous.todos.map((todo) => [todo.id, todo.status]));
  return next.todos
    .filter((todo) => todo.status === "completed" && before.has(todo.id) && before.get(todo.id) !== "completed")
    .map((todo) => todo.id);
}

export const STATUS_ICON: Record<TodoStatus, string> = {
  completed: "✓",
  in_progress: "◐",
  pending: "○",
  cancelled: "✗",
};

/** Cuts text to a display width, ending with an ellipsis when it had to cut. */
export function truncate(text: string, width: number): string {
  const chars = Array.from(text);
  if (chars.length <= width) return text;
  if (width <= 1) return "…".slice(0, Math.max(0, width));
  return chars.slice(0, width - 1).join("") + "…";
}

/** The rows the expanded list shows, and how many were left out. */
export function expandedRows(list: TodoList, max: number): { rows: Todo[]; hidden: number } {
  if (list.todos.length <= max) return { rows: list.todos, hidden: 0 };
  // Keep the current item in view: start the window just before it.
  const currentIndex = list.todos.findIndex((todo) => todo.status === "in_progress" || todo.status === "pending");
  const start = Math.max(0, Math.min(currentIndex - 1, list.todos.length - max));
  const rows = list.todos.slice(start, start + max);
  return { rows, hidden: list.todos.length - rows.length };
}
