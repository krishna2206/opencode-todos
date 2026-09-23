/** @jsxImportSource @opentui/solid */

// opencode-todos: TUI side. One line right above the prompt with the task in
// progress; a click shows the whole list. The list comes from the server
// plugin over RPC, pulled again whenever it announces a change.

import { Plugin } from "@opencode/plugin/tui";
import { RGBA, TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { TodosRpc } from "./rpc.js";
import { EMPTY_LIST, type Todo, type TodoList } from "./todos.js";
import { expandedRows, lineView, newlyCompleted, STATUS_ICON, truncate } from "./view.js";

type Ctx = Plugin.Context;

const id = "opencode-todos";

const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"];
const SPINNER_MS = 150;
/** How long a completed item stays on the line, in the success colour, before the next one shows. */
const COMPLETE_FLASH_MS = 900;
const FADE_MS = 240;
const FADE_STEPS = 6;

interface LineState {
  todo: Todo;
  text: string;
  fg: RGBA;
}

interface Options {
  animations: boolean;
  maxExpandedRows: number;
  doneLingerMs: number;
}

function readOptions(options: Readonly<Record<string, unknown>>): Options {
  const positive = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
  return {
    animations: options.animations !== false,
    maxExpandedRows: Math.floor(positive(options.maxExpandedRows, 10)),
    doneLingerMs: positive(options.doneLingerMs, 3000),
  };
}

function mix(from: RGBA, to: RGBA, t: number): RGBA {
  const k = Math.min(1, Math.max(0, t));
  return RGBA.fromValues(
    from.r + (to.r - from.r) * k,
    from.g + (to.g - from.g) * k,
    from.b + (to.b - from.b) * k,
    from.a + (to.a - from.a) * k,
  );
}

/** A 0 → 1 ramp restarted by `start()`; stays at 1 when animations are off. */
function createFade(enabled: boolean) {
  const [progress, setProgress] = createSignal(1);
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
  onCleanup(stop);
  return {
    progress,
    start() {
      if (!enabled) return;
      stop();
      let step = 0;
      setProgress(0);
      timer = setInterval(() => {
        step += 1;
        setProgress(step / FADE_STEPS);
        if (step >= FADE_STEPS) stop();
      }, FADE_MS / FADE_STEPS);
    },
  };
}

/** The session's directory: RPC calls must reach the server plugin of that location. */
function sessionLocation(ctx: Ctx, sessionID: string) {
  const directory = ctx.data.session.get(sessionID)?.location.directory ?? ctx.location?.directory;
  return directory ? { directory } : undefined;
}

function TodoBar(props: { ctx: Ctx; sessionID: string; options: Options }) {
  const theme = () => props.ctx.theme;
  const dimensions = useTerminalDimensions();
  const client = props.ctx.client.rpc(TodosRpc);

  const [list, setList] = createSignal<TodoList>(EMPTY_LIST);
  const [expanded, setExpanded] = createSignal(false);
  const [flash, setFlash] = createSignal<Todo | undefined>();
  const [lingering, setLingering] = createSignal(false);
  const [frame, setFrame] = createSignal(0);
  const fade = createFade(props.options.animations);

  let requested = 0;
  // `announce`: a change the server just made, to animate. The load when a
  // session opens only shows the list as it is.
  const load = async (announce: boolean) => {
    const ticket = ++requested;
    try {
      const next = (await client.list(
        { sessionID: props.sessionID },
        { location: sessionLocation(props.ctx, props.sessionID) },
      )) as TodoList;
      if (ticket === requested) apply(next, announce);
    } catch {
      // Server plugin not ready or not loaded: keep what is shown.
    }
  };

  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (ms: number, run: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
  };
  onCleanup(() => timers.forEach(clearTimeout));

  const apply = (next: TodoList, announce: boolean) => {
    const previous = list();
    if (next.revision === previous.revision) return;
    setList(next);
    if (!announce) return;
    const completed = newlyCompleted(previous, next);
    const item = completed.length > 0 ? next.todos.find((todo) => todo.id === completed.at(-1)) : undefined;
    if (item && props.options.animations) {
      setFlash(item);
      later(COMPLETE_FLASH_MS, () => {
        setFlash(undefined);
        fade.start();
      });
    } else {
      fade.start();
    }
    if (lineView(next).finished) {
      setLingering(true);
      later(props.options.doneLingerMs, () => setLingering(false));
    }
  };

  createEffect(
    on(
      () => props.sessionID,
      () => {
        setList(EMPTY_LIST);
        setExpanded(false);
        void load(false);
        const unsubscribe = client.events.on("changed", (event) => {
          if (event.data.sessionID === props.sessionID) void load(true);
        });
        onCleanup(unsubscribe);
      },
    ),
  );

  const view = createMemo(() => lineView(list()));
  const running = () => props.ctx.data.session.status(props.sessionID) === "running";

  createEffect(() => {
    if (!props.options.animations || !view().current || !running()) return;
    const timer = setInterval(() => setFrame((value) => (value + 1) % SPINNER_FRAMES.length), SPINNER_MS);
    onCleanup(() => clearInterval(timer));
  });

  const visible = () => view().total > 0 && (!view().finished || lingering() || flash() !== undefined);
  const width = () => Math.max(20, dimensions().width - 16);

  const icon = (todo: Todo) =>
    todo.status === "in_progress" && running() && props.options.animations
      ? SPINNER_FRAMES[frame()]!
      : STATUS_ICON[todo.status];

  const iconColor = (todo: Todo): RGBA => {
    const t = theme();
    if (todo.status === "completed") return t.text.feedback.success.base;
    if (todo.status === "in_progress") return t.text.feedback.warning.base;
    return t.text.muted;
  };

  const textColor = (todo: Todo): RGBA => {
    const t = theme();
    if (todo.status === "in_progress") return t.text.base;
    return t.text.muted;
  };

  // The collapsed line: the item just completed (briefly), else the current
  // one, else the closing summary.
  const line = createMemo((): LineState | undefined => {
    const done = flash();
    if (done) return { todo: done, text: done.content, fg: theme().text.feedback.success.base };
    const current = view().current;
    if (current) return { todo: current, text: current.content, fg: mix(theme().text.muted, theme().text.base, fade.progress()) };
    return undefined;
  });

  const counter = () => `${view().done}/${view().total}`;

  return (
    <Show when={visible()}>
      <box
        flexDirection="column"
        width="100%"
        flexShrink={0}
        // Lines the text up with the prompt's, which starts after its "┃ " border.
        paddingLeft={2}
        paddingRight={1}
        // A row of space before the prompt: terminal cells allow nothing finer.
        paddingBottom={1}
        onMouseUp={() => setExpanded((value) => !value)}
      >
        <Show
          when={!expanded()}
          fallback={
            <ExpandedList
              ctx={props.ctx}
              list={list()}
              max={props.options.maxExpandedRows}
              width={width()}
              icon={icon}
              iconColor={iconColor}
              textColor={textColor}
              counter={counter()}
            />
          }
        >
          <box flexDirection="row">
            <Show
              when={line()}
              fallback={
                <text fg={theme().text.feedback.success.base} wrapMode="none">
                  {`✓ ${counter()} done`}
                </text>
              }
            >
              {(current: () => LineState) => (
                <>
                  <text fg={flash() ? theme().text.feedback.success.base : iconColor(current().todo)} wrapMode="none">
                    {flash() ? "✓" : icon(current().todo)}
                  </text>
                  <text fg={current().fg} wrapMode="none">
                    {` ${truncate(current().text, width() - counter().length - 4)}`}
                  </text>
                  <text fg={theme().text.muted} wrapMode="none">
                    {`  ${counter()}`}
                  </text>
                </>
              )}
            </Show>
          </box>
        </Show>
      </box>
    </Show>
  );
}

function ExpandedList(props: {
  ctx: Ctx;
  list: TodoList;
  max: number;
  width: number;
  icon: (todo: Todo) => string;
  iconColor: (todo: Todo) => RGBA;
  textColor: (todo: Todo) => RGBA;
  counter: string;
}) {
  const window = createMemo(() => expandedRows(props.list, props.max));
  return (
    <box flexDirection="column">
      <text fg={props.ctx.theme.text.muted} wrapMode="none">
        {`Todos  ${props.counter}`}
      </text>
      <For each={window().rows}>
        {(todo) => (
          <box flexDirection="row">
            <text fg={props.iconColor(todo)} wrapMode="none">
              {props.icon(todo)}
            </text>
            <text
              fg={props.textColor(todo)}
              attributes={
                todo.status === "cancelled"
                  ? TextAttributes.STRIKETHROUGH
                  : todo.status === "in_progress"
                    ? TextAttributes.BOLD
                    : 0
              }
              wrapMode="none"
            >
              {` ${truncate(todo.content, props.width - 2)}`}
            </text>
          </box>
        )}
      </For>
      <Show when={window().hidden > 0}>
        <text fg={props.ctx.theme.text.muted} wrapMode="none">
          {`  +${window().hidden} more`}
        </text>
      </Show>
    </box>
  );
}

export default Plugin.define({
  id,
  setup: (ctx) => {
    const options = readOptions(ctx.options);
    // Right above the prompt. Other plugins appending to this slot stack in
    // config order; the last one listed sits against the prompt.
    const unclaim = ctx.ui.slot({
      append: "session.composer.top",
      render: (input) => <TodoBar ctx={ctx} sessionID={input.sessionID} options={options} />,
    });
    return () => unclaim();
  },
});
