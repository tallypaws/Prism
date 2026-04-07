import type {
	ApplicationCommandOptionData,
	ApplicationCommandSubCommandData,
	ApplicationCommandType,
	Awaitable,
	PermissionsBitField,
} from "discord.js";
import type { GuildValue } from "../util.js";
import type { FlatCommandData, FlatCommandHandler, FlatCommandOptions } from "./commands/flat.js";
import type { MenuCommandContext, MenuCommandData, MenuCommandHandler } from "./commands/menu.js";
import type { SubGroupsData, SubGroupsHandler, SubGroupsOptions } from "./commands/sub-groups.js";
import type {
	SubcommandData,
	SubcommandHandler,
	SubcommandOptions,
} from "./commands/subcommands.js";

import { ApplicationCommandOptionType } from "discord.js";

import { transformOptions } from "./commands/options.js";

/** An object containing all registered commands. */
export const commands: Record<string, StoredCommandData[]> = {};
/** The application command data stored internally. */
type StoredBaseCommandData = {
	name: string;
	global: boolean;
	allowGuild?: GuildValue<boolean>;
	defaultMemberPermissions: PermissionsBitField | null;
};
type StoredSubcommandMap = SubcommandData<boolean, SubcommandOptions<boolean>>["subcommands"];
type StoredSubGroupMap = SubGroupsData<boolean, SubGroupsOptions<boolean>>["subcommands"];
type StoredChatCommandData = StoredBaseCommandData & {
	description: string;
	type: ApplicationCommandType.ChatInput;
};
export type StoredCommandData =
	| (StoredChatCommandData & {
			options?: FlatCommandOptions<boolean>;
			command: FlatCommandHandler;
	  })
	| (StoredChatCommandData & {
			subcommands: StoredSubcommandMap;
			command: SubcommandHandler;
	  })
	| (StoredChatCommandData & {
			subcommands: StoredSubGroupMap;
			command: SubGroupsHandler;
	  })
	| (StoredBaseCommandData & {
			description: string;
			type: MenuCommandContext;
			command: MenuCommandHandler;
	  });

/** Any command configuration data that can be passed to a `defineXYZ()` function. */
export type CommandData<InGuild extends boolean> =
	| MenuCommandData<InGuild, MenuCommandContext>
	| SubGroupsData<InGuild, SubGroupsOptions<InGuild>>
	| SubcommandData<InGuild, SubcommandOptions<InGuild>>
	| FlatCommandData<InGuild, FlatCommandOptions<InGuild>>;

/** Base command configuration data. */
export type BaseCommandData<InGuild extends boolean> = (InGuild extends true ? BaseGuildCommandData
:	BaseGlobalCommandData)
	& AugmentedCommandData<InGuild>;
/** Can be augmented to add custom command properties (advanced usage) */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions, @typescript-eslint/no-unused-vars
export interface AugmentedCommandData<_InGuild extends boolean> {}

/** Properties allowed in any command confuguration data. */
export type BaseCommandKeys = keyof BaseCommandData<boolean>;

/** Base guild command configuration data. */
export type BaseGuildCommandData = {
	name: string;
	global?: false;
	/**
	 * Whether to deny members permission to use the command, and require guild admins to explicitly
	 * set permissions via `Server Settings` -> `Integrations`.
	 */
	restricted?: boolean;
	/** Whether to register this command in a guild. Defaults to `true`. */
	allowGuild?: GuildValue<boolean>;
};
/** Base global command configuration data. */
export type BaseGlobalCommandData = {
	name: string;
	restricted?: never;
	global?: true;
	allowGuild?: never;
};
/**
 * By default, commands are allowed in all guilds plus DMs.
 *
 * To change this behavior, you can set {@link LoginOptions.defaultCommandAccess} when logging in.
 * When using TypeScript, it is necessary to augment the `DefaultCommandAccess` interface when
 * changing this.
 *
 * @property {boolean} inGuild Whether or not commands are restricted to guilds-only by default.
 *   Defaults to `false`.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export interface DefaultCommandAccess {}

/** Base chat command configuration data. */
export type BaseChatCommandData<InGuild extends boolean> = {
	description: string;
	type?: never;
} & BaseCommandData<InGuild>
	& AugmentedChatCommandData<InGuild>;
/** Can be augmented to add custom chat command properties (advanced usage) */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions, @typescript-eslint/no-unused-vars
export interface AugmentedChatCommandData<_InGuild extends boolean> {}

/** @internal */
export async function transformSubcommands(
	subcommands: Record<
		string,
		Omit<FlatCommandData<boolean, SubcommandOptions<boolean>[string]>, BaseCommandKeys>
	>,
	metadata: { command: string; subGroup?: string },
	guildId: string,
): Promise<ApplicationCommandSubCommandData[]> {
	const transformed = await Promise.all(
		Object.entries(subcommands).map(
			async ([subcommand, command]: [string, (typeof subcommands)[string]]) => ({
				name: subcommand,
				description: command.description,
				type: ApplicationCommandOptionType.Subcommand,
				options:
					command.options
					&& (await transformOptions(command.options, { ...metadata, subcommand }, guildId)),
			}),
		),
	);

	return transformed as ApplicationCommandSubCommandData[];
}
