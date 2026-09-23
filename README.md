# opencode-todos

A todo list for the model, and a live view of it above the prompt, for opencode 2.

opencode 2 removed its built-in todo tool
([anomalyco/opencode#35989](https://github.com/anomalyco/opencode/pull/35989),
reasons in [#42421](https://github.com/anomalyco/opencode/issues/42421)). This plugin
brings the tool back with the V1 call shape and adds a compact TUI line.

## What it does

**For the model**

- A `todowrite` tool with the V1 shape: the model sends the complete list every time,
  with `pending` / `in_progress` / `completed` / `cancelled` items.
- A light tool description: use it for work with three or more steps, skip it otherwise.
  V1's heavier guidance pushed models to use it where it did not help
  ([#48111](https://github.com/anomalyco/opencode/issues/48111)).
- Items keep their identity across calls (by echoed id, else by identical content).
- After a compaction drops the last `todowrite` call from the context, the open list is
  put back into the system prompt, so the model does not lose its plan.

**In the TUI**

- One line right above the prompt: the item in progress (or the next pending one) and a
  counter, e.g. `◐ Run the benchmark  2/6`.
- A click on the line shows the whole list; another click folds it back.
- Animations: a spinner while the session works, the completed item flashing green
  before the next one fades in, and `✓ 6/6 done` for a few seconds when the list ends.
- Nothing shows when there is no list. A finished list shows `✓ n/n done` briefly, then
  hides, and is not shown when the session is reopened; it stays stored until the
  session is deleted.

## Install

```sh
git clone https://github.com/krishna2206/opencode-todos.git
cd opencode-todos
pnpm install
pnpm build
```

Then declare the built `dist` directory in `~/.config/opencode/opencode.jsonc`
(the path must point to the directory: opencode resolves `dist/index` for the server
side and `dist/tui` for the TUI side):

```jsonc
{
  "plugins": [
    { "package": "file:///path/to/opencode-todos/dist" }
  ]
}
```

Other plugins that append to the space above the prompt stack in config order; the last
one listed sits against the prompt. Do not load another plugin that also registers a
`todowrite` tool.

## Options

Set under the plugin entry's `options`:

| Option | Default | Meaning |
|---|---|---|
| `animations` | `true` | Spinner, completion flash and fades |
| `maxExpandedRows` | `10` | Rows shown when the list is unfolded (the current item stays in view) |
| `doneLingerMs` | `3000` | How long `✓ n/n done` stays once the list is finished |

## How it works

- **Server** (`src/index.ts`): the `todowrite` tool, the `context` hook that restores the
  list after a compaction, and cleanup: a session's list is removed when the session is
  deleted, and a daily sweep (`src/sweep.ts`) removes lists whose session was deleted
  while the plugin was not running. A list is only removed when opencode reports its
  session as not found, never on another error. Lists are kept in
  opencode's own durable key-value storage (`ctx.storage`), scoped to this plugin: no
  database of its own and nothing written to your repositories.
- **RPC** (`src/rpc.ts`): `list({ sessionID })`, and a `changed` event after every write.
  The TUI pulls the list when told it changed.
- **TUI** (`src/tui.tsx`): the line, on the `session.composer.top` slot.
- **Pure logic** (`src/todos.ts`, `src/view.ts`, `src/sweep.ts`): list updates, what the
  line shows and the sweep, covered by `pnpm test`.

## Development

```sh
pnpm build   # empties dist without deleting it, so opencode keeps hot reloading
pnpm test
```

## License

MIT
