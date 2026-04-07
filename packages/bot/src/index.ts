import "./env.js";
import { isDev } from "common/constants";
console.log();
console.log(`starting in ${isDev ? "development" : "production"} mode`);
console.log();

import { ActivityType, GatewayIntentBits } from "discord.js";
import { fileURLToPath } from "node:url";
import login, { client } from "@tally/stride";
import { connectDBS } from "@tally/db";

console.log("initilizing database");

await connectDBS({
  surreal: {
    namespace: "prism",
    database: "dev",
    username: "root",
    password: "root",
    url: "ws://localhost:9000/rpc",
  },
  redis: {
    url: "redis://localhost:6379",
  },
});

await login({
  logLevel: "all",
  modulesDirectory: fileURLToPath(new URL("./modules", import.meta.url)),
  clientOptions: {
    intents:
      GatewayIntentBits.Guilds |
      GatewayIntentBits.GuildMembers |
      GatewayIntentBits.GuildModeration |
      GatewayIntentBits.GuildExpressions |
      GatewayIntentBits.GuildWebhooks |
      GatewayIntentBits.GuildInvites |
      GatewayIntentBits.GuildVoiceStates |
      GatewayIntentBits.GuildPresences |
      GatewayIntentBits.GuildMessages |
      GatewayIntentBits.GuildMessageReactions |
      GatewayIntentBits.DirectMessages |
      GatewayIntentBits.MessageContent |
      GatewayIntentBits.GuildScheduledEvents |
      GatewayIntentBits.AutoModerationExecution,
    presence: {
      status: "idle",
      activities: [{ name: "Bootin up...", type: ActivityType.Custom }],
    },
  },
});
console.log("Login complete.");

// client.user.setActivity("prism v2 is very mraowmeemew", { type: ActivityType.Custom });
client.user.setPresence({
  status: "online",
  activities: [
    { name: "prism v2 is very mraowmeemew", type: ActivityType.Custom },
  ],
});
