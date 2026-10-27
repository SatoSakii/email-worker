import { listBlocklist } from "../db/blocklist";

export function matchesPattern(pattern: string, address: string): boolean
{
	const expected = pattern.toLowerCase();
	const actual = address.toLowerCase();

	if (expected.startsWith("*@"))
	{
		return actual.endsWith(expected.slice(1));
	}

	return expected === actual;
}

export async function isBlocked(db: D1Database, senders: string[], alias: string): Promise<boolean>
{
	const entries = await listBlocklist(db);

	return entries.some((entry) =>
	{
		if (entry.type === "alias")
		{
			return matchesPattern(entry.pattern, alias);
		}

		return senders.some((sender) => matchesPattern(entry.pattern, sender));
	});
}
