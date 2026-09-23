import { describe, expect, it } from "bun:test";
import { applyWrite, EMPTY_LIST, isOpen, renderForModel, validate, type TodoInput } from "../src/todos";
import { expandedRows, lineView, newlyCompleted, truncate } from "../src/view";

const write = (input: TodoInput[], previous = EMPTY_LIST, now = 1000) => applyWrite(previous, input, now);

describe("applyWrite", () => {
  it("assigns ids and bumps the revision", () => {
    const list = write([
      { content: "a", status: "in_progress" },
      { content: "b", status: "pending" },
    ]);
    expect(list.revision).toBe(1);
    expect(new Set(list.todos.map((todo) => todo.id)).size).toBe(2);
  });

  it("keeps identity by echoed id, else by identical content", () => {
    const first = write([
      { content: "a", status: "in_progress" },
      { content: "b", status: "pending" },
    ]);
    const [a, b] = first.todos;
    const second = write(
      [
        { id: a!.id, content: "a, renamed", status: "completed" },
        { content: "b", status: "in_progress" },
      ],
      first,
      2000,
    );
    expect(second.todos[0]!.id).toBe(a!.id);
    expect(second.todos[1]!.id).toBe(b!.id);
    expect(second.todos[0]!.createdAt).toBe(1000);
  });

  it("stamps completedAt once and keeps it", () => {
    const first = write([{ content: "a", status: "completed" }], EMPTY_LIST, 1000);
    const second = write([{ content: "a", status: "completed" }], first, 5000);
    expect(second.todos[0]!.completedAt).toBe(1000);
  });

  it("drops items left out of the new list", () => {
    const first = write([
      { content: "a", status: "pending" },
      { content: "b", status: "pending" },
    ]);
    expect(write([{ content: "b", status: "pending" }], first).todos.map((todo) => todo.content)).toEqual(["b"]);
  });
});

describe("validate and render", () => {
  it("rejects empty content", () => {
    expect(() => validate([{ content: "  ", status: "pending" }])).toThrow();
  });

  it("renders a compact list with ids for the model", () => {
    const text = renderForModel(write([
      { content: "a", status: "completed" },
      { content: "b", status: "in_progress" },
    ]));
    expect(text).toContain("[x] a (id: ");
    expect(text).toContain("[~] b (id: ");
    expect(text).toContain("1/2 completed");
  });

  it("is open while something is left to do", () => {
    expect(isOpen(write([{ content: "a", status: "completed" }]))).toBe(false);
    expect(isOpen(write([{ content: "a", status: "pending" }]))).toBe(true);
  });
});

describe("view", () => {
  it("shows the item in progress, else the next pending, and counts done items", () => {
    const list = write([
      { content: "a", status: "completed" },
      { content: "b", status: "pending" },
      { content: "c", status: "in_progress" },
      { content: "d", status: "cancelled" },
    ]);
    const view = lineView(list);
    expect(view.current?.content).toBe("c");
    expect(view.done).toBe(1);
    expect(view.total).toBe(3);
    expect(view.finished).toBe(false);
    expect(lineView(write([{ content: "b", status: "pending" }])).current?.content).toBe("b");
  });

  it("is finished when nothing is left", () => {
    expect(lineView(write([{ content: "a", status: "completed" }])).finished).toBe(true);
  });

  it("finds the items completed between two revisions", () => {
    const first = write([
      { content: "a", status: "in_progress" },
      { content: "b", status: "pending" },
    ]);
    const second = write(
      [
        { content: "a", status: "completed" },
        { content: "b", status: "in_progress" },
      ],
      first,
    );
    expect(newlyCompleted(first, second)).toEqual([first.todos[0]!.id]);
    expect(newlyCompleted(second, second)).toEqual([]);
  });

  it("truncates with an ellipsis", () => {
    expect(truncate("abcdef", 10)).toBe("abcdef");
    expect(truncate("abcdef", 4)).toBe("abc…");
  });

  it("keeps the current item in the expanded window", () => {
    const list = write(
      Array.from({ length: 20 }, (_, index) => ({
        content: `t${index}`,
        status: index < 15 ? ("completed" as const) : index === 15 ? ("in_progress" as const) : ("pending" as const),
      })),
    );
    const { rows, hidden } = expandedRows(list, 5);
    expect(rows.map((todo) => todo.content)).toContain("t15");
    expect(hidden).toBe(15);
  });
});
