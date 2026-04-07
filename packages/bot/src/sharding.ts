import "./env.js";

import {
  ActivityType,
  GatewayIntentBits,
  type GuildTextBasedChannel,
  Message,
  Shard,
  ShardingManager,
} from "discord.js";
import { Client } from "discord.js";
import { getCommitEmbedsFromURL } from "./git.js";
// import "./register.js";
// import "@stride";

const PHOTON_TOKEN = process.env.PHOTON_TOKEN;
let photon: Client | null = null;
let photonLogs: GuildTextBasedChannel | null = null;

if (PHOTON_TOKEN) {
  photon = new Client({
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
      status: "dnd",
      activities: [{ name: "Startup", type: ActivityType.Custom }],
    },
  });

  await photon.login(PHOTON_TOKEN);
  const photonGuild = await photon.guilds.fetch("1282133612195479635");
  photonLogs = (await photonGuild.channels.fetch(
    "1295037638490980372",
  )) as GuildTextBasedChannel;
  if (!photonLogs?.isSendable()) throw new Error("Photon logs isn't sendable!");
  photon.user?.setStatus("online");
  photon.user?.setActivity({ name: "", type: ActivityType.Custom });
  await photonLogs.send("Photon Started");
}

async function getGuildCount(client: Client): Promise<number> {
  await client.login(process.env.BOT_TOKEN);
  const guildCount = client.guilds.cache.size;
  console.log(`Found ${guildCount} guilds`);
  if (photonLogs) await photonLogs.send(`Found ${guildCount} guilds`);
  await client.destroy();
  return guildCount;
}

async function calculateTotalShards(guildCount: number): Promise<number> {
  const guildsPerShard = 1500;
  const totalShards = Math.ceil(guildCount / guildsPerShard);
  console.log(`Using ${totalShards} Shards`);
  if (photonLogs) await photonLogs.send(`Using ${totalShards} Shards`);
  return totalShards;
}

function generateShardList(totalShards: number): number[] {
  return Array.from({ length: totalShards }, (_, i) => i);
}

async function startSharding() {
  const client = new Client({ intents: GatewayIntentBits.Guilds });

  try {
    const guildCount = await getGuildCount(client);
    const totalShards = await calculateTotalShards(guildCount);
    const shardList = generateShardList(totalShards);
    const manager = new ShardingManager("./dist/index.js", {
      token: process.env.BOT_TOKEN!,
      respawn: process.env.NODE_ENV !== "development",
      execArgv: ["--loader", "./load.mjs", "--enable-source-maps"],

      totalShards,
      shardList,
    });

    manager.on("shardCreate", (shard: Shard) => {
      console.log(`Launched shard ${shard.id}`);
      if (photonLogs) photonLogs.send(`Shard ${shard.id} started`);
    });

    const shards = await manager.spawn();

    shards.forEach((shard) =>
      shard.on("message", (m) => {
        if (m.message === "refresh") {
          manager.broadcast(m);
        } else if (m.message === "log" && photonLogs) {
          photonLogs.send(m.data);
        } else if (m.event) {
          manager.broadcast(m);
        }
      }),
    );
  } catch (error) {
    console.error("Error getting guild count or spawning shards:", error);
  }
}

if (photonLogs) await photonLogs.send("Starting Sharding");
await startSharding();
if (photonLogs) await photonLogs.send("Sharding Done");

if (photon) {
  photon.on("messageCreate", async (message) => {
    if (message.author.id === photon!.user?.id) return;
    const commitUrls = extractCommitUrls(message);
    if (commitUrls) {
      for (let commit of commitUrls) {
        await message.channel.send({
          embeds: (await getCommitEmbedsFromURL(commit)) ?? [],
        });
      }
    }
  });
}

process.on("uncaughtException", (e) => {
  void e;
});

function extractCommitUrls(embed: Message) {
  const description = embed.embeds[0]?.description;
  return description?.match(/https:\/\/github\.com\/\S+\/commit\/\w+/g);
}

// async function sendPing() {
//   const response = await fetch(
//     "https://monitor.tally.gay/api/push/QtoIFvsSDF?status=up&msg=OK&ping=",
//   );
//   if (!response.ok) {
//     console.error("Failed to send ping");
//   }
// }

// sendPing();

// setInterval(
//   sendPing,
//   20000,
// );
