// The RPC domain between the server plugin, which owns the lists, and the TUI,
// which shows them. The event only says "this session changed, at this
// revision": the TUI then pulls the list, so the event never has to carry it.

import { Rpc } from "@opencode/plugin/rpc";

const todoSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    content: { type: "string" },
    status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled"] },
    priority: { type: "string", enum: ["high", "medium", "low"] },
    createdAt: { type: "number" },
    completedAt: { type: "number" },
  },
  required: ["id", "content", "status", "createdAt"],
} as const;

export const TodosRpc = Rpc.define({
  id: "opencode-todos",
  methods: {
    list: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
      },
      output: {
        type: "object",
        properties: {
          revision: { type: "number" },
          updatedAt: { type: "number" },
          todos: { type: "array", items: todoSchema },
        },
        required: ["revision", "updatedAt", "todos"],
      },
    },
  },
  events: {
    changed: {
      schema: {
        type: "object",
        properties: { sessionID: { type: "string" }, revision: { type: "number" } },
        required: ["sessionID", "revision"],
      },
    },
  },
} as const);
