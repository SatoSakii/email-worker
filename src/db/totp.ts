export interface TotpRow
{
	id: string;
	alias: string;
	name: string;
	secret: string;
	digits: number;
	period: number;
	algorithm: string;
	created_at: number;
}

export type NewTotp = Pick<TotpRow, "name" | "secret" | "digits" | "period" | "algorithm">;

export async function listTotp(db: D1Database, alias: string): Promise<TotpRow[]>
{
	const { results } = await db.prepare("SELECT * FROM totp_keys WHERE alias = ? ORDER BY created_at, id").bind(alias).all<TotpRow>();
	return results;
}

export async function countTotp(db: D1Database, alias: string): Promise<number>
{
	const row = await db.prepare("SELECT COUNT(*) AS total FROM totp_keys WHERE alias = ?").bind(alias).first<{ total: number }>();
	return row?.total ?? 0;
}

export async function insertTotp(db: D1Database, alias: string, key: NewTotp): Promise<TotpRow>
{
	const row: TotpRow = { id: crypto.randomUUID(), alias, ...key, created_at: Date.now() };

	await db.prepare("INSERT INTO totp_keys (id, alias, name, secret, digits, period, algorithm, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
		.bind(row.id, row.alias, row.name, row.secret, row.digits, row.period, row.algorithm, row.created_at)
		.run();

	return row;
}

export async function deleteTotp(db: D1Database, alias: string, id: string): Promise<boolean>
{
	const result = await db.prepare("DELETE FROM totp_keys WHERE id = ? AND alias = ?").bind(id, alias).run();
	return result.meta.changes > 0;
}
