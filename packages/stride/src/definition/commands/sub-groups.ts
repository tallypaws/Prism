import type { Awaitable, ChatInputCommandInteraction } from "discord.js";
import type { GuildCacheReducer } from "../../util.js";
import type { BaseChatCommandData, BaseCommandKeys } from "../commands.js";
import type { FlatCommandOptions } from "./flat.js";
import type { OptionsToType } from "./options.js";
import type { SubcommandData, SubcommandOptions } from "./subcommands.js";

import { ApplicationCommandType, PermissionsBitField } from "discord.js";

import { commands } from "../commands.js";
import { loginActive } from "../../index.js";

/**
 * Define subcommand groups.
 *
 * @param data Sub group configuration data.
 * @param handler The command handler.
 */
export function defineSubGroups<InGuild extends true, Options extends SubGroupsOptions<InGuild>>(
	data: SubGroupsData<InGuild, Options>,
	handler: (
		interaction: ChatInputCommandInteraction<GuildCacheReducer<InGuild>>,
		options: {
			[G in keyof Options]: {
				[S in keyof Options[G]]: {
					subcommand: S;
					subGroup: G;
					options: OptionsToType<InGuild, Options[G][S]>;
				};
			}[keyof Options[G]];
		}[keyof Options],
	) => Awaitable<unknown>,
): void;
export function defineSubGroups<InGuild extends false, Options extends SubGroupsOptions<InGuild>>(
	data: SubGroupsData<InGuild, Options>,
	handler: (
		interaction: ChatInputCommandInteraction<GuildCacheReducer<InGuild>>,
		options: {
			[G in keyof Options]: {
				[S in keyof Options[G]]: {
					subcommand: S;
					subGroup: G;
					options: OptionsToType<InGuild, Options[G][S]>;
				};
			}[keyof Options[G]];
		}[keyof Options],
	) => Awaitable<unknown>,
): void;
export function defineSubGroups(
	data: SubGroupsData<boolean, SubGroupsOptions<boolean>>,
	handler: SubGroupsHandler,
): void {
		if (!loginActive)
			throw new ReferenceError("Commands cannot be defined after login");
	const oldCommand = commands[data.name]?.[0];
	if (oldCommand && (oldCommand.command as SubGroupsHandler) !== handler)
		throw new ReferenceError(`Command ${data.name} has already been defined`);

	if (data.global && data.allowGuild !== undefined)
		throw new TypeError("Commands cannot define both `allowGuild` and `global`");

	commands[data.name] ??= [];
	commands[data.name]?.push({
		name: data.name,
		description: data.description,
		subcommands: data.subcommands,
		global: data.global ?? false,
		allowGuild: data.allowGuild,
		command: handler,
		type: ApplicationCommandType.ChatInput,
		defaultMemberPermissions: data.restricted ? new PermissionsBitField() : null,
	});
}

/** Subgroup command configuration data. */
export type SubGroupsData<InGuild extends boolean, Options extends SubGroupsOptions<InGuild>> = {
	options?: never;
	/**
	 * Key-value pair where the keys are subgroup names and the values are subgroup details. In
	 * order for the handler to be correctly typed, all subcommands must have
	 * {@link FlatCommandData.options} set, even if just to an empty object.
	 *
	 * Mixing subgroups and subcommands on the same level is not currently supported.
	 */
	subcommands: {
		[key in keyof Options]: Omit<SubcommandData<InGuild, Options[key]>, BaseCommandKeys>;
	};
} & BaseChatCommandData<InGuild>
	& AugmentedSubGroupsData<InGuild, Options>;
/** Options for a subgroup command. */
export type SubGroupsOptions<InGuild extends boolean> = Record<string, SubcommandOptions<InGuild>>;
/** A subgroup command handler. */
export type SubGroupsHandler = (
	interaction: ChatInputCommandInteraction,
	options: {
		subcommand: string;
		subGroup: string;
		options: OptionsToType<boolean, FlatCommandOptions<boolean>>;
	},
) => Awaitable<unknown>;
/** Can be augmented to add custom subgroup command properties (advanced usage) */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export interface AugmentedSubGroupsData<
	InGuild extends boolean,
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	_Options extends SubGroupsOptions<InGuild>,
> {}
