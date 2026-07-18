import { AgentDiariesPlugin } from "@agent-diaries/core";
import { RedisCacheProvider } from "./RedisCacheProvider";
import { RedisLockProvider } from "./RedisLockProvider";

export function createRedisPlugin(options: any = {}): AgentDiariesPlugin {
  return {
    name: "@agent-diaries/redis",
    version: "2.0.0",
    storage: {
      cache: new RedisCacheProvider(options),
      lock: new RedisLockProvider(options),
    },
  };
}
