import { setupInvalidationPubSub } from "./cache.js";
import { createClient } from "redis";

let client: ReturnType<typeof createClient>;

export async function connectRedis({
  url,
  username,
  password,
}: { url?: string; username?: string; password?: string }) {
  if (!client) {
    client = createClient({
      url,
      username,
      password,
    });
    client.on("error", (err) => console.error("Redis Client Error", err));
    await client.connect();
    await setupInvalidationPubSub();
  }
}

export function getRedis(): ReturnType<typeof createClient> | false {
  if (!client.isOpen) {
    return false;
  }
  return client;
}
