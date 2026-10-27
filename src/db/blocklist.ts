export type BlocklistType = "sender" | "alias";

export interface BlocklistRow
{
	id: string;
	type: BlocklistType;
	pattern: string;
	created_at: number;
}

export async function listBlocklist(db: D1Database): Promise<BlocklistRow[]>
{
	const { results } = await db.prepare("SELECT id, type, pattern, created_at FROM blocklist ORDER BY created_at DESC, id")
		.all<BlocklistRow>();
	return results;
}

export async function addBlocklistEntry(db: D1Database, type: BlocklistType, pattern: string): Promise<BlocklistRow | null>
{
	const entry: BlocklistRow = { id: crypto.randomUUID(), type, pattern, created_at: Date.now() };
	const result = await db.prepare("INSERT INTO blocklist (id, type, pattern, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (type, pattern) DO NOTHING")
		.bind(entry.id, entry.type, entry.pattern, entry.created_at)
		.run();
	return result.meta.changes === 0 ? null : entry;
}

export async function removeBlocklistEntry(db: D1Database, id: string): Promise<boolean>
{
	const result = await db.prepare("DELETE FROM blocklist WHERE id = ?").bind(id).run();
	return result.meta.changes > 0;
}
