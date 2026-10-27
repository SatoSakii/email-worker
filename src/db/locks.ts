export interface LockRow
{
	alias: string;
	pin_hash: string;
	pin_salt: string;
	failed_attempts: number;
	blocked_until: number;
	created_at: number;
}

export async function getLock(db: D1Database, alias: string): Promise<LockRow | null>
{
	return await db.prepare("SELECT * FROM mailbox_locks WHERE alias = ?").bind(alias).first<LockRow>();
}

export async function insertLock(db: D1Database, alias: string, pin_hash: string, pin_salt: string): Promise<boolean>
{
	const result = await db.prepare("INSERT INTO mailbox_locks (alias, pin_hash, pin_salt, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (alias) DO NOTHING")
		.bind(alias, pin_hash, pin_salt, Date.now())
		.run();
	return result.meta.changes > 0;
}

export async function saveAttempts(db: D1Database, alias: string, failed_attempts: number, blocked_until: number): Promise<void>
{
	await db.prepare("UPDATE mailbox_locks SET failed_attempts = ?, blocked_until = ? WHERE alias = ?")
		.bind(failed_attempts, blocked_until, alias)
		.run();
}

export async function deleteLock(db: D1Database, alias: string): Promise<boolean>
{
	const result = await db.prepare("DELETE FROM mailbox_locks WHERE alias = ?").bind(alias).run();
	return result.meta.changes > 0;
}
