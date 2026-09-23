// Lists live in opencode's own durable key-value storage, which the host
// scopes to this plugin. Nothing lands in the user's repositories, and there is
// no database of our own to open or migrate.

import type { Plugin } from "@opencode/plugin";
import { EMPTY_LIST, type TodoList } from "./todos.js";

type Storage = Plugin.Context["storage"];

const key = (sessionID: string) => `session/${sessionID}`;

function isList(value: unknown): value is TodoList {
  const list = value as TodoList | undefined;
  return typeof list?.revision === "number" && Array.isArray(list?.todos);
}

export function createStore(storage: Storage) {
  return {
    async read(sessionID: string): Promise<TodoList> {
      const value = await storage.get(key(sessionID));
      return isList(value) ? value : EMPTY_LIST;
    },
    async write(sessionID: string, list: TodoList): Promise<void> {
      await storage.set(key(sessionID), list as unknown as Parameters<Storage["set"]>[1]);
    },
    async remove(sessionID: string): Promise<void> {
      await storage.remove(key(sessionID));
    },
  };
}

export type Store = ReturnType<typeof createStore>;
