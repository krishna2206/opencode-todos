// opencode-todos: server side.
//
// opencode 2 removed its todo tool (anomalyco/opencode#35989). This plugin gives
// the model a `todowrite` tool with the V1 call shape, keeps each session's list
// in opencode's storage, tells the TUI when a list changes, and puts the open
// list back in front of the model after a compaction dropped the last write.

import { Plugin } from "@opencode/plugin";
import { Schema } from "effect";
import { TodosRpc } from "./rpc.js";
import { createStore } from "./store.js";
import { applyWrite, isOpen, PRIORITIES, renderForModel, STATUSES, validate } from "./todos.js";

const TOOL = "todowrite";

// Deliberately light. V1's guidance, with its rules and examples, pushed models
// to use the tool even where it did not help (anomalyco/opencode#48111).
const DESCRIPTION = [
  "Keep a todo list for the current session so progress on multi-step work stays visible to the user.",
  "Use it when the work has three or more distinct steps, or the user gives several tasks; skip it for a single simple task or a pure question.",
  "Send the complete list every time: items left out are dropped. Echo each item's id to keep its identity.",
  "Keep exactly one item in_progress while working, and mark items completed as soon as they are done.",
].join(" ");

const Input = Schema.Struct({
  todos: Schema.Array(
    Schema.Struct({
      id: Schema.optional(Schema.String.annotate({ description: "Id of an existing item, as returned by a previous call" })),
      content: Schema.String.annotate({ description: "What the task is" }),
      status: Schema.Literals(STATUSES),
      priority: Schema.optional(Schema.Literals(PRIORITIES)),
    }),
  ).annotate({ description: "The complete todo list" }),
});

export default Plugin.define({
  id: "opencode-todos",
  setup: async (ctx) => {
    const store = createStore(ctx.storage);
    const rpc = await ctx.rpc.register(TodosRpc, {
      // The host types RPC input as unknown: check it rather than trust it.
      list: async (input) => {
        const sessionID = (input as { sessionID?: unknown } | undefined)?.sessionID;
        if (typeof sessionID !== "string") throw new Error("list: sessionID is required");
        return store.read(sessionID);
      },
    });

    await ctx.tool.transform((tools) => {
      tools.add({
        name: TOOL,
        options: { codemode: false },
        description: DESCRIPTION,
        input: Input,
        execute: async (input, context) => {
          const todos = input.todos.map((todo) => ({ ...todo }));
          validate(todos);
          const next = applyWrite(await store.read(context.sessionID), todos, Date.now());
          await store.write(context.sessionID, next);
          await rpc.events.emit("changed", { sessionID: context.sessionID, revision: next.revision });
          return {
            content: renderForModel(next),
            metadata: { revision: next.revision, total: next.todos.length },
          };
        },
      });
    });

    // After a compaction the model no longer sees its last todowrite call, and
    // with it its plan. The open list goes back into the system prompt then,
    // and only then: once the model writes again, the call is in context and
    // this stops, so the prompt stays stable turn to turn.
    await ctx.session.hook("context", async (event) => {
      const seen = event.messages.some((message) =>
        message.content.some((part) => part.type === "tool-call" && part.name === TOOL),
      );
      if (seen) return;
      const list = await store.read(event.sessionID);
      if (!isOpen(list)) return;
      event.system.push({
        type: "text",
        text: `# Current todo list\nYour todo list for this session, as last written with ${TOOL}:\n\n${renderForModel(list)}`,
      });
    });

    // A deleted session's list goes with it.
    const stop = new AbortController();
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: stop.signal })) {
          if (event.type === "session.deleted") await store.remove(event.data.sessionID).catch(() => {});
        }
      } catch {
        // Aborted on cleanup, or the stream ended: nothing left to prune then.
      }
    })();

    return () => stop.abort();
  },
});
