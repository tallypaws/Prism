// CACHING!! FINALLY!!!!!!!!!

import { m, TimedMap } from "@thetally/toolbox";
import { getRedis } from "./redis.js";

const localId = Math.random().toString(16).slice(2);

const cache = new TimedMap(m(2).toMs());
function debugLog(...args: any[]) {
  console.log("cache: ", ...args);
}

export async function setupInvalidationPubSub() {
  debugLog("setting up pubsub");
  const redis = getRedis();
  if (!redis) return;

  const subClient = redis.duplicate();
  await subClient.connect();

  await subClient.subscribe("cache-invalidation", (message) => {
    const keys = message.split(":");
    const id = keys.shift()!;
    if (id === localId) return;
    debugLog("received invalidation message for keys:", keys);
    invalidate(keys);
  });
  debugLog("finished setting up pubsub");
}

export function setCache<T>(keys: string[], value: T) {
  debugLog("cache set:", keys);

  cache.set(keys.join(":"), value);
  const redis = getRedis();
  if (redis) {
    redis.publish("cache-invalidation", `${localId}:${keys.join(":")}`);
  }
}

export function getCache<T>(keys: string[]): T | undefined {
  const v = cache.get(keys.join(":")) as T;
  debugLog(`cache ${!!v ? "hit" : "miss"}`, keys);
  return v;
}

export function invalidateCache(keys: string[]) {
  debugLog("cache invalidate", keys);
  cache.delete(keys.join(":"));
  const redis = getRedis();
  if (redis) {
    redis.publish("cache-invalidation", `${localId}:${keys.join(":")}`);
  }
}

function invalidate(keys: string[]) {
  cache.delete(keys.join(":"));
}

// literally only for types beacsue its annoying otherwise
export class CacheHelper<T> {
  protected name: string;

  constructor(datatype: string, name: string) {
    this.name = `${datatype}:${name}`;
    debugLog("cache helper", this.name, "created");
  }

  set(keys: string[], value: T) {
    setCache([this.name, ...keys], value);
  }

  get(keys: string[]): T | undefined {
    return getCache([this.name, ...keys]);
  }

  invalidate(keys: string[]) {
    invalidateCache([this.name, ...keys]);
  }
}
