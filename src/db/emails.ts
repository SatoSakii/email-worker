export interface EmailRow
{
	id: string;
	message_id: string | null;
	from_address: string;
	from_name: string;
	to_address: string;
	subject: string;
	text_body: string;
	html_body: string;
	received_at: number;
	size: number;
	raw_key: string;
	is_read: number;
	is_starred: number;
	is_deleted: number;
	has_attachments: number;
	parse_failed: number;
}

export interface AttachmentRow
{
	id: string;
	email_id: string;
	filename: string;
	content_type: string;
	size: number;
	r2_key: string;
}

export type NewEmail = Omit<EmailRow, "is_read" | "is_starred" | "is_deleted">;

export type EmailSummary = Pick<EmailRow, "id" | "from_address" | "from_name" | "to_address" | "subject" | "received_at" | "size" | "is_read" | "is_starred" | "is_deleted" | "has_attachments" | "parse_failed">;

export interface ListFilters
{
	alias?: string;
	q?: string;
	unread?: boolean;
	starred?: boolean;
	trash?: boolean;
	limit: number;
	cursor?: { received_at: number; id: string };
}

const SUMMARY_COLUMNS = "e.id, e.from_address, e.from_name, e.to_address, e.subject, e.received_at, e.size, e.is_read, e.is_starred, e.is_deleted, e.has_attachments, e.parse_failed";

export async function emailExists(db: D1Database, message_id: string, to_address: string): Promise<boolean>
{
	const row = await db.prepare("SELECT 1 AS found FROM emails WHERE message_id = ? AND to_address = ?")
		.bind(message_id, to_address)
		.first();
	return row !== null;
}

export async function insertEmail(db: D1Database, email: NewEmail, attachments: AttachmentRow[]): Promise<void>
{
	const statements = [
		db.prepare("INSERT INTO emails (id, message_id, from_address, from_name, to_address, subject, text_body, html_body, received_at, size, raw_key, has_attachments, parse_failed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
			.bind(
				email.id,
				email.message_id,
				email.from_address,
				email.from_name,
				email.to_address,
				email.subject,
				email.text_body,
				email.html_body,
				email.received_at,
				email.size,
				email.raw_key,
				email.has_attachments,
				email.parse_failed,
			),
		...attachments.map((attachment) => db.prepare("INSERT INTO attachments (id, email_id, filename, content_type, size, r2_key) VALUES (?, ?, ?, ?, ?, ?)")
			.bind(attachment.id, attachment.email_id, attachment.filename, attachment.content_type, attachment.size, attachment.r2_key)),
	];

	await db.batch(statements);
}

export function toFtsQuery(q: string): string | null
{
	const terms = q.split(/\s+/).filter((term) => /[\p{L}\p{N}]/u.test(term));
	if (terms.length === 0)
	{
		return null;
	}

	return terms.map((term) => `"${term.replaceAll("\"", "\"\"")}"`).join(" ");
}

export async function storageUsed(db: D1Database): Promise<number>
{
	const row = await db.prepare("SELECT (SELECT COALESCE(SUM(size), 0) FROM emails) + (SELECT COALESCE(SUM(size), 0) FROM attachments) AS used")
		.first<{ used: number }>();
	return row?.used ?? 0;
}

export async function listEmails(db: D1Database, filters: ListFilters): Promise<EmailSummary[]>
{
	const conditions = [filters.trash ? "e.is_deleted = 1" : "e.is_deleted = 0"];
	const params: (string | number)[] = [];

	if (filters.alias)
	{
		conditions.push("e.to_address = ?");
		params.push(filters.alias.toLowerCase());
	}
	if (filters.unread)
	{
		conditions.push("e.is_read = 0");
	}
	if (filters.starred)
	{
		conditions.push("e.is_starred = 1");
	}
	if (filters.q !== undefined && filters.q.trim() !== "")
	{
		const query = toFtsQuery(filters.q);
		if (query === null)
		{
			return [];
		}
		conditions.push("e.rowid IN (SELECT rowid FROM emails_fts WHERE emails_fts MATCH ?)");
		params.push(query);
	}
	if (filters.cursor)
	{
		conditions.push("(e.received_at < ? OR (e.received_at = ? AND e.id < ?))");
		params.push(filters.cursor.received_at, filters.cursor.received_at, filters.cursor.id);
	}
	params.push(filters.limit + 1);

	const { results } = await db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM emails e WHERE ${conditions.join(" AND ")} ORDER BY e.received_at DESC, e.id DESC LIMIT ?`)
		.bind(...params)
		.all<EmailSummary>();
	return results;
}

export async function getEmail(db: D1Database, id: string): Promise<EmailRow | null>
{
	return await db.prepare("SELECT * FROM emails WHERE id = ?").bind(id).first<EmailRow>();
}

export async function listAttachments(db: D1Database, email_id: string): Promise<AttachmentRow[]>
{
	const { results } = await db.prepare("SELECT * FROM attachments WHERE email_id = ? ORDER BY id")
		.bind(email_id)
		.all<AttachmentRow>();
	return results;
}

export async function getAttachment(db: D1Database, id: string): Promise<AttachmentRow | null>
{
	return await db.prepare("SELECT * FROM attachments WHERE id = ?").bind(id).first<AttachmentRow>();
}

export type FlagPatch = Partial<Pick<EmailRow, "is_read" | "is_starred" | "is_deleted">>;

export async function updateFlags(db: D1Database, id: string, patch: FlagPatch): Promise<boolean>
{
	const assignments = Object.keys(patch).map((column) => `${column} = ?`).join(", ");
	const result = await db.prepare(`UPDATE emails SET ${assignments} WHERE id = ?`)
		.bind(...Object.values(patch), id)
		.run();
	return result.meta.changes > 0;
}

export async function deleteEmail(db: D1Database, id: string): Promise<void>
{
	await db.prepare("DELETE FROM emails WHERE id = ?").bind(id).run();
}
