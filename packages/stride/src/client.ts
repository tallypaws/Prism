import type {
  ApplicationCommandData as DiscordApplicationCommandData,
  Awaitable,
  ClientOptions,
  RepliableInteraction,
  Snowflake,
} from "discord.js";
import type {
  DefaultCommandAccess,
  StoredCommandData,
} from "./definition/commands.js";
import type {
  FlatCommandHandler,
  FlatCommandOptions,
} from "./definition/commands/flat.js";
import type { MenuCommandHandler } from "./definition/commands/menu.js";
import type {
  SubGroupsData,
  SubGroupsHandler,
  SubGroupsOptions,
} from "./definition/commands/sub-groups.js";
import type {
  SubcommandData,
  SubcommandHandler,
  SubcommandOptions,
} from "./definition/commands/subcommands.js";
import type { EventHandler, StrifeEvents } from "./definition/events.js";
import type { SendableChannel } from "./util.js";

import assert from "node:assert";
import fileSystem from "node:fs/promises";
import path from "node:path";
import url from "node:url";

import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  BaseInteraction,
  Client,
  DiscordAPIError,
  GuildChannel,
  GuildMember,
  MessageFlags,
  Partials,
  RESTJSONErrorCodes,
  Role,
  version,
} from "discord.js";

import { commands, transformSubcommands } from "./definition/commands.js";
import {
  autocompleters,
  NoSubcommand,
  transformOptions,
} from "./definition/commands/options.js";
import { buttons, modals, selects } from "./definition/components.js";
import { defineEvent, getEvents } from "./definition/events.js";
import { logError } from "./errors.js";
import { resolveGuildValue } from "./util.js";

/**
 * Once {@link login()} has been called, you may import this from anywhere in your app to access the
 * client instance it created.
 *
 * Note that although this is typed as {@link Client<true>}, it is `undefined` prior to calling
 * {@link login()}. Please plan appropriately.
 */
export let client: Client<true>;

export let loginActive = false;

export type LogLevel =
  | "all"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "critical"
  | "none";

const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
  all: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  critical: 5,
  none: 6,
};

const DEFAULT_LOG_LEVEL: LogLevel =
  process.env.NODE_ENV === "production" ? "debug" : "all";

export let logLevel: LogLevel = DEFAULT_LOG_LEVEL;

function shouldLog(level: LogLevel): boolean {
  if (logLevel === "all") return true;
  if (logLevel === "none") return false;
  return LOG_LEVEL_WEIGHT[level] >= LOG_LEVEL_WEIGHT[logLevel];
}

/**
 * Connect to Discord and instantiate a discord.js client.
 *
 * @param loginOptions Configuration.
 */
export async function login(loginOptions: LoginOptions): Promise<void> {
  loginActive = true;
  const [major, minor = "", patch] = version.split(".");
  if (major !== "14" || +minor < 9 || +minor > 22 || patch?.includes("-dev"))
    // process.emitWarning(
    //   `You are using an non-officially-supported version of discord.js (${version}). Please use version 14.9-14.22 for maximum stability.`,
    //   "ExperimentalWarning"
    // ); // stfu
    true; // do nothing lmao

  const Handler = new Client({
    allowedMentions: { parse: ["users"], repliedUser: true },
    failIfNotExists: false,
    partials: [
      Partials.User,
      Partials.Channel,
      Partials.GuildMember,
      Partials.Message,
      Partials.Reaction,
      Partials.GuildScheduledEvent,
      Partials.ThreadMember,
    ],
    ...loginOptions.clientOptions,
  });

  logLevel =
    loginOptions.logLevel ??
    (loginOptions.debug === undefined
      ? DEFAULT_LOG_LEVEL
      : loginOptions.debug === "all"
      ? "all"
      : loginOptions.debug
      ? "debug"
      : "none");
  let handleError = await buildErrorHandler();

  const readyPromise = new Promise<Client<true>>((resolve) => {
    Handler.once("clientReady", resolve);
  });
  Handler.on("debug", (message) => {
    if (
      shouldLog("debug") &&
      (logLevel === "all" ||
        (!message.includes("Sending a heartbeat") &&
          !message.includes("Heartbeat acknowledged")))
    )
      console.debug(message);
  })
    .on("warn", (warning) => {
      if (!shouldLog("warn")) return;
      return handleError(warning, "warn");
    })
    .on("error", (error) => {
      if (!shouldLog("error")) return;
      return handleError(error, "error");
    })
    .on("invalidated", () => {
      if (shouldLog("critical"))
        console.error(
          "[ReferenceError]",
          new ReferenceError("Session is invalid")
        );
      process.exit(1);
    })
    .rest.on("invalidRequestWarning", (data) => {
      if (!shouldLog("warn")) return;
      return handleError(
        `${data.count.toLocaleString()} requests; ${data.remainingTime.toLocaleString()}ms left`,
        "invalidRequestWarning"
      );
    })
    .on("restDebug", (message) => {
      if (
        shouldLog("debug") &&
        (logLevel === "all" || !message.includes("Received bucket hash update"))
      )
        console.debug(message);
    });

  await Handler.login(loginOptions.botToken ?? process.env.BOT_TOKEN);
  client = await readyPromise;

  if (shouldLog("info"))
    console.log(`Connected to Discord with tag ${client.user.tag}`);

  if (loginOptions.handleError)
    handleError =
      typeof loginOptions.handleError === "function"
        ? loginOptions.handleError
        : await buildErrorHandler(loginOptions.handleError);

  if (loginOptions.modulesDir)
    process.emitWarning(
      "The `modulesDir` option is deprecated. Please use `modulesDirectory` instead.",
      "DeprecationWarning"
    );

  const directories = loginOptions.modulesDirectory
    ? [loginOptions.modulesDirectory].flat()
    : loginOptions.modulesDir
    ? [loginOptions.modulesDir]
    : [];

  const promises = directories.map(async (directory) => {
    const modules = await fileSystem.readdir(directory, {
      withFileTypes: true,
    });
    const promises = modules.map(async (module) => {
      if (module.isFile() && path.extname(module.name) !== ".js") return;

      const resolved = module.isDirectory()
        ? path.join(directory, module.name, "index.js")
        : path.join(directory, module.name);

      await import(url.pathToFileURL(resolved).toString());
    });
    return await Promise.all(promises);
  });

  await Promise.all(promises);

  defineEvent("interactionCreate", async (interaction) => {
    if (interaction.isAutocomplete()) {
      const command = interaction.command?.name ?? "";
      const subGroup = interaction.options.getSubcommandGroup();
      const subcommand = interaction.options.getSubcommand(false);
      const option = interaction.options.getFocused(true).name;

      const autocomplete =
        autocompleters[command]?.[subGroup ?? NoSubcommand]?.[
          subcommand ?? NoSubcommand
        ]?.[option];

      if (!autocomplete)
        throw new ReferenceError(
          `Autocomplete handler for \`/${command}${
            subGroup ? ` ${subGroup}` : ""
          }${
            subcommand ? ` ${subcommand}` : ""
          }\`’s \`${option}\` option not found`
        );

      await interaction.respond(autocomplete(interaction).slice(0, 25));
      return;
    }

    if (!interaction.isCommand()) {
      const [data, id] = interaction.customId.split(/(?<=^[^_]*)_/);
      if (!id) return;

      if (interaction.isButton()) await buttons[id]?.(interaction, data ?? "");
      else if (interaction.isModalSubmit())
        await modals[id]?.(interaction, data ?? "");
      else if (interaction.isAnySelectMenu())
        await selects[id]?.(interaction, data ?? "");

      return;
    }

    if (!interaction.command) throw new ReferenceError("Unknown command run");
    const storedCommand = commands[interaction.command.name]?.[0];
    if (!storedCommand)
      throw new ReferenceError(
        `Command \`${interaction.command.name}\` not found`
      );

    if (interaction.isContextMenuCommand()) {
      if (storedCommand.type === ApplicationCommandType.ChatInput)
        throw new ReferenceError(
          `Command \`${interaction.command.name}\` does not support context menus`
        );
      await (storedCommand.command as MenuCommandHandler)(interaction);
    } else if (interaction.isChatInputCommand()) {
      if (storedCommand.type !== ApplicationCommandType.ChatInput)
        throw new ReferenceError(
          `Command \`${interaction.command.name}\` does not support chat input`
        );
      const { command } = storedCommand;
      const rawOptions =
        interaction.options.data[0]?.options?.[0]?.options ??
        interaction.options.data[0]?.options ??
        interaction.options.data;

      const optionsData = rawOptions.map(
        async (option) =>
          [
            option.name,
            (option.attachment ??
              (!option.channel || option.channel instanceof GuildChannel
                ? option.channel
                : await interaction.guild?.channels.fetch(option.channel.id)) ??
              (option.member instanceof GuildMember && option.member)) ||
              (option.user ??
                (!option.role || option.role instanceof Role
                  ? option.role
                  : await interaction.guild?.roles.fetch(option.role.id)) ??
                option.value),
          ] as const
      );
      const parsedOptions = Object.fromEntries(await Promise.all(optionsData));

      const subGroup = interaction.options.getSubcommandGroup();
      const subcommand = interaction.options.getSubcommand(false);
      if (subGroup && subcommand)
        await (command as SubGroupsHandler)(interaction, {
          subcommand,
          subGroup,
          options: parsedOptions,
        });
      else if (subcommand)
        await (command as SubcommandHandler)(interaction, {
          subcommand,
          options: parsedOptions,
        });
      else await (command as FlatCommandHandler)(interaction, parsedOptions);
    }
  });

  for (const [event, execute] of Object.entries(getEvents()) as [
    StrifeEvents,
    EventHandler<StrifeEvents>
  ][])
    client.on(event, async (...args) => {
      try {
        await execute(...args);
      } catch (error) {
        const interaction =
          args[0] instanceof BaseInteraction && !args[0].isAutocomplete()
            ? args[0]
            : undefined;
        if (shouldLog("error")) await handleError(error, interaction ?? event);

        if (!loginOptions.commandErrorMessage) return;

        if (interaction?.deferred || interaction?.replied)
          await interaction.followUp({
            flags: MessageFlags.Ephemeral,
            content: loginOptions.commandErrorMessage,
          });
        else if (
          Number(interaction?.createdAt) - Date.now() < 3000 &&
          !(
            error instanceof DiscordAPIError &&
            error.code === RESTJSONErrorCodes.UnknownInteraction
          )
        )
          await interaction?.reply({
            flags: MessageFlags.Ephemeral,
            content: loginOptions.commandErrorMessage,
          });
      }
    });

  const guilds = await client.guilds.fetch();

  await commandManager.registerGlobalCommands();

  const registerPromises = guilds.map((guild) =>
    commandManager.registerCommandsForGuild(guild.id)
  );
  await Promise.all(registerPromises);

  loginActive = false;
}

export const commandManager = {
  get commands() {
    return commands;
  },
  async commandsForGuild(guildId: string) {
    const guildCommands: Record<string, StoredCommandData[]> = {};
    for (const [commandName, commandVariants] of Object.entries(commands)) {
      for (const command of commandVariants) {
        if (command.global) {
          (guildCommands[commandName] ??= []).push(command);
          continue;
        }

        const allowGuild = command.allowGuild;
        if (!allowGuild) continue;

        const isAllowed = await resolveGuildValue(allowGuild, guildId);
        if (isAllowed) (guildCommands[commandName] ??= []).push(command);
      }
    }
    return guildCommands;
  },

  async registerCommandsForGuild(guildId: string) {
    const guildCommands = await this.commandsForGuild(guildId);
    const existingCommands = [
      ...(await client.application.commands
        .fetch({
          guildId,
        })
        .then((cmds) => cmds.values())),
    ];
    const existingCommandData: DiscordApplicationCommandData[] =
      existingCommands.map((cmd) => {
        const data = "toJSON" in cmd ? (cmd as any).toJSON() : (cmd as any);
        if (data.descriptionLocalizations === null)
          data.descriptionLocalizations = undefined;
        return data as DiscordApplicationCommandData;
      });

    const builtCommands: DiscordApplicationCommandData[] = [];
    for (const [commandName, commandVariants] of Object.entries(
      guildCommands
    )) {
      for (const command of commandVariants) {
        builtCommands.push(
          await buildCommandForGuild(commandName, command, guildId)
        );
      }
    }

    const areSame = compareCommands(existingCommandData, builtCommands);
    console.log({ areSame, existingCommandData, builtCommands });
    if (areSame) {
      if (shouldLog("info"))
        console.log(
          `No changes detected for commands in guild ${guildId}, skipping registration`
        );
      return;
    }
    await client.application.commands.set(builtCommands, guildId);

    if (shouldLog("info"))
      console.log(
        `Registered ${builtCommands.length} commands for guild ${guildId}`
      );
  },

  async registerGlobalCommands() {
    const builtCommands: DiscordApplicationCommandData[] = [];
    for (const [commandName, commandVariants] of Object.entries(commands)) {
      for (const command of commandVariants) {
        if (command.global) {
          builtCommands.push(
            await buildCommandForGuild(commandName, command, "global")
          );
        }
      }
    }

    await client.application.commands.set(builtCommands);
    if (shouldLog("info"))
      console.log(`Registered ${builtCommands.length} global commands`);
  },
};

function compareCommands(
  oldCommands: DiscordApplicationCommandData[],
  newCommands: DiscordApplicationCommandData[]
) {
  if (oldCommands.length !== newCommands.length) return false;

  const keyedByName: Record<string, DiscordApplicationCommandData> = {};
  for (const command of oldCommands) {
    keyedByName[command.name] = command;
  }

  for (const newCommand of newCommands) {
    const oldCommand = keyedByName[newCommand.name];
    if (!oldCommand) return false;

    if (!deepEquals(oldCommand, newCommand)) return false;
  }

  return true;
}

function deepEquals(obj1: any, obj2: any): boolean {
  // could be non objects

  if (obj1 === obj2) return true;

  if (
    typeof obj1 !== "object" ||
    obj1 === null ||
    typeof obj2 !== "object" ||
    obj2 === null
  ) {
    return false;
  }

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) return false;

  for (const key of keys1) {
    if (!keys2.includes(key)) return false;

    if (!deepEquals(obj1[key], obj2[key])) return false;
  }

  return true;
}

function isFlatCommandData(
  command: StoredCommandData
): command is StoredCommandData & {
  command: FlatCommandHandler;
  options?: FlatCommandOptions<boolean>;
} {
  return (
    command.type === ApplicationCommandType.ChatInput && "options" in command
  );
}

function isSubGroupsCommand(
  command: StoredCommandData
): command is StoredCommandData & {
  command: SubGroupsHandler;
  subcommands: SubGroupsData<boolean, SubGroupsOptions<boolean>>["subcommands"];
} {
  if (
    command.type !== ApplicationCommandType.ChatInput ||
    !("subcommands" in command)
  )
    return false;

  const firstSubcommand = Object.values(command.subcommands ?? {})[0];
  return (
    !!firstSubcommand &&
    typeof firstSubcommand === "object" &&
    "subcommands" in firstSubcommand
  );
}

function isSubcommandCommand(
  command: StoredCommandData
): command is StoredCommandData & {
  command: SubcommandHandler;
  subcommands: SubcommandData<
    boolean,
    SubcommandOptions<boolean>
  >["subcommands"];
} {
  return (
    command.type === ApplicationCommandType.ChatInput &&
    "subcommands" in command &&
    !isSubGroupsCommand(command)
  );
}

async function buildCommandForGuild(
  commandName: string,
  command: StoredCommandData,
  guildId: string
): Promise<DiscordApplicationCommandData> {
  if (command.type !== ApplicationCommandType.ChatInput)
    return {
      name: commandName,
      type: command.type,
      defaultMemberPermissions: command.defaultMemberPermissions,
      // description: command.description,
      dmPermission: command.global ? true : undefined,
    };

  const baseData = {
    name: commandName,
    description: command.description,
    type: command.type,
    defaultMemberPermissions: command.defaultMemberPermissions,
    dmPermission: command.global ? true : undefined,
  };

  if (isFlatCommandData(command))
    return {
      ...baseData,
      options:
        command.options &&
        (await transformOptions(
          command.options,
          { command: commandName },
          guildId
        )),
    };

  if (isSubGroupsCommand(command)) {
    const subcommandEntries = Object.entries(command.subcommands);
    return {
      ...baseData,
      options: await Promise.all(
        subcommandEntries.map(async ([subcommand, data]) => ({
          name: subcommand,
          description: data.description,
          type: ApplicationCommandOptionType.SubcommandGroup,
          options: await transformSubcommands(
            data.subcommands,
            { command: commandName, subGroup: subcommand },
            guildId
          ),
        }))
      ),
    };
  }

  if (isSubcommandCommand(command))
    return {
      ...baseData,
      options: await transformSubcommands(
        command.subcommands,
        { command: commandName },
        guildId
      ),
    };

  throw new TypeError(`Unknown command configuration for \`${commandName}\``);
}

/** Configuration. */
export type LoginOptions = {
  /**
   * Options to pass to discord.js. As in discord.js, the only required property is `intents`.
   * strife.js has some defaults on top of discord.js's, which will be merged with these options,
   * but all are still overridable.
   *
   * - `allowedMentions` is set to only ping users by default (including replied users) to avoid
   *   accidental mass pings.
   * - `failIfNotExists` is set to `false` to return `null` instead of erroring in certain cases.
   * - `partials` is set to all available partials to avoid missed events.
   *
   * @default {
   * 	allowedMentions: { parse: ["users"]; repliedUser: true };
   * 	failIfNotExists: false;
   * 	partials: [
   * 		Partials.User,
   * 		Partials.Channel,
   * 		Partials.GuildMember,
   * 		Partials.Message,
   * 		Partials.Reaction,
   * 		Partials.GuildScheduledEvent,
   * 		Partials.ThreadMember,
   * 	];
   * }
   */
  clientOptions: ClientOptions;
  /** @deprecated Use {@link LoginOptions.modulesDirectory} */
  modulesDir?: string;
  /**
   * The directory to import modules from. It is recommended to set this to `fileURLToPath(new
   * URL("./modules", import.meta.url))`. Omit to not load any modules.
   */
  modulesDirectory?: string | string[];
  /**
   * The token to connect to Discord with.
   *
   * @default `process.env.BOT_TOKEN`
   */
  botToken?: string;
  /**
   * The message displayed to the user when commands fail. Omit to use Discord's default `❗ The
   * application did not respond`.
   */
  commandErrorMessage?: string;
  /**
   * Defines how errors should be handled in discord.js or any event, component, or command
   * handler. Can either be a function that will be called on each error, or an object defining
   * how strife.js should handle it. If not set, all errors will only be logged through
   * {@link console.error()}. If set to an object, strife.js will log the error in the console,
   * then standardize it and format it nicely before sending it in a channel of your chosing. You
   * can also optionally specify an emoji to be included in the error log message for aesthetic
   * purposes.
   */
  handleError?:
    | ((
        error: unknown,
        event: RepliableInteraction | string
      ) => Awaitable<void>)
    | { channel: string | (() => Awaitable<SendableChannel>); emoji?: string }
    | undefined;
  /**
   * Controls logging verbosity, ranging from `"all"` (log everything, including websocket
   * heartbeats and REST bucket updates) to `"none"` (suppress all logging performed during
   * {@link login()}).
   *
   * - `"debug"` logs most non-spammy debug messages (still skips heartbeats and REST bucket hash
   *   updates) in addition to everything from `"info"` and above.
   * - `"info"` logs startup messages plus all warnings, errors, and critical failures.
   * - `"warn"` logs warnings, errors, and critical failures.
   * - `"error"` logs errors and critical failures.
   * - `"critical"` only logs critical failures.
   * - `"all"` logs absolutely everything.
   * - `"none"` suppresses all logging performed by strife.js during {@link login()}.
   *
   * @default process.env.NODE_ENV === "production" ? "debug" : "all"
   */
  logLevel?: LogLevel;
  /** @deprecated Use {@link LoginOptions.logLevel} instead. */
  debug?: boolean | "all";
} & (DefaultCommandAccess extends { inGuild: true }
  ? {
      /** The default value of {@link BaseCommandData.allowGuild a command's `allowGuild` field}. */
      defaultCommandAccess: boolean | ((guildId: string) => Awaitable<boolean>);
    }
  : {
      /** The default value of {@link BaseCommandData.allowGuild a command's `allowGuild` field}. */
      defaultCommandAccess?:
        | boolean
        | ((guildId: string) => Awaitable<boolean>);
    });
async function buildErrorHandler(options?: {
  channel: string | (() => Awaitable<SendableChannel>);
  emoji?: string;
}): Promise<
  (error: unknown, event: RepliableInteraction | string) => Awaitable<void>
> {
  const channel =
    typeof options?.channel === "string"
      ? (await client.channels.fetch(options.channel)) ?? undefined
      : await options?.channel();
  if (options) assert(channel, "Could not find provided error log channel");
  if (channel)
    assert(
      "send" in channel,
      "Provided error log channel is not a sendable channel"
    );
  return async (error: unknown, event: RepliableInteraction | string) => {
    await logError({ error, event, channel, emoji: options?.emoji });
  };
}
