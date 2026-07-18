import { AgentDiariesPlugin } from "@agent-diaries/core";
import { PostgresPersistenceProvider } from "./PostgresPersistenceProvider";
import { PostgresLockProvider } from "./PostgresLockProvider";

export function createPostgresPlugin(options: any = {}): AgentDiariesPlugin {
  return {
    name: "@agent-diaries/postgres",
    version: "2.0.0",
    storage: {
      persistence: new PostgresPersistenceProvider(options),
      lock: new PostgresLockProvider(options),
    },
  };
}
