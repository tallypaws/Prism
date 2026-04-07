import type { Awaitable, CacheType, Channel } from "discord.js";

/** @internal */
export type GuildCacheReducer<InGuild extends boolean> =
	InGuild extends true ? "cached" | "raw" : CacheType;

/** A function argument that can be static or resolved per guild. */
export type GuildValue<Type> = Type | ((guildId: string) => Awaitable<Type>);

/**
 * The symbol Discord uses between the text and timestamp in an embed footer. Can be used between
 * strings to create a natural-looking break in footer text.
 */
export const footerSeperator = " • ";

/** A zero-width space, useful to create embed fields with an empty title and/or value. */
export const zeroWidthSpace = "\u200b";

/** @internal */
export type SendableChannel = Extract<Channel, { send(...args: unknown[]): unknown }>;

/** Resolve a {@link GuildValue} into a concrete value for the provided guild. */
export async function resolveGuildValue<Type>(
	value: GuildValue<Type> | undefined,
	guildId: string,
): Promise<Type | undefined> {
	return typeof value === "function" ?
		await (value as (guildId: string) => Awaitable<Type>)(guildId)
	:	value;
}
