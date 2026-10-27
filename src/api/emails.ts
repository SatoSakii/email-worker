import { Hono } from "hono";
import { deleteEmail, getEmail, listAttachments, listEmails, updateFlags } from "../db/emails";
import type { EmailSummary, FlagPatch } from "../db/emails";
import type { AppEnv } from "../types";
import { readJsonObject } from "./body";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const CURSOR = /^(\d+):([0-9a-f-]{36})$/;
const FLAGS = ["is_read", "is_starred", "is_deleted"] as const;

export function toSummary(row: EmailSummary)
{
	return {
		id: row.id,
		from_address: row.from_address,
		from_name: row.from_name,
		to_address: row.to_address,
		subject: row.subject,
		received_at: row.received_at,
		size: row.size,
		is_read: row.is_read === 1,
		is_starred: row.is_starred === 1,
		is_deleted: row.is_deleted === 1,
		has_attachments: row.has_attachments === 1,
		parse_failed: row.parse_failed === 1,
	};
}

export const emailRoutes = new Hono<AppEnv>();

emailRoutes.get("/", async (c) =>
{
	const limitParam = c.req.query("limit");
	const requested = limitParam === undefined ? DEFAULT_LIMIT : Number(limitParam);
	if (!Number.isInteger(requested) || requested < 1)
	{
		return c.json({ errors: ["invalid limit"] }, 400);
	}
	const limit = Math.min(requested, MAX_LIMIT);

	let cursor: { received_at: number; id: string } | undefined;
	const cursorParam = c.req.query("cursor");
	if (cursorParam !== undefined)
	{
		const match = CURSOR.exec(cursorParam);
		if (!match)
		{
			return c.json({ errors: ["invalid cursor"] }, 400);
		}
		cursor = { received_at: Number(match[1]), id: match[2] };
	}

	const rows = await listEmails(c.env.DB, {
		alias: c.req.query("alias"),
		unread: c.req.query("unread") === "1",
		starred: c.req.query("starred") === "1",
		trash: c.req.query("trash") === "1",
		limit,
		cursor,
	});

	const page = rows.slice(0, limit);
	const last = page[page.length - 1];
	const nextCursor = rows.length > limit ? `${last.received_at}:${last.id}` : null;

	return c.json({ emails: page.map(toSummary), next_cursor: nextCursor });
});

emailRoutes.get("/:id/raw", async (c) =>
{
	const email = await getEmail(c.env.DB, c.req.param("id"));
	const object = email ? await c.env.BUCKET.get(email.raw_key) : null;
	if (!email || !object)
	{
		return c.json({ errors: ["not found"] }, 404);
	}

	return new Response(object.body, {
		headers: {
			"Content-Type": "message/rfc822",
			"Content-Disposition": `attachment; filename="${email.id}.eml"`,
		},
	});
});

emailRoutes.get("/:id", async (c) =>
{
	const email = await getEmail(c.env.DB, c.req.param("id"));
	if (!email)
	{
		return c.json({ errors: ["not found"] }, 404);
	}

	const attachments = await listAttachments(c.env.DB, email.id);

	return c.json({
		...toSummary(email),
		message_id: email.message_id,
		text_body: email.text_body,
		html_body: email.html_body,
		attachments: attachments.map((attachment) => ({
			id: attachment.id,
			filename: attachment.filename,
			content_type: attachment.content_type,
			size: attachment.size,
		})),
	});
});

emailRoutes.patch("/:id", async (c) =>
{
	const body = await readJsonObject(c.req.raw);
	if (!body)
	{
		return c.json({ errors: ["invalid request body"] }, 400);
	}

	const patch: FlagPatch = {};
	for (const flag of FLAGS)
	{
		const value = body[flag];
		if (value === undefined)
		{
			continue;
		}
		if (typeof value !== "boolean")
		{
			return c.json({ errors: [`${flag} must be a boolean`] }, 400);
		}
		patch[flag] = value ? 1 : 0;
	}
	if (Object.keys(patch).length === 0)
	{
		return c.json({ errors: ["no flag to update"] }, 400);
	}

	const id = c.req.param("id");
	if (!await updateFlags(c.env.DB, id, patch))
	{
		return c.json({ errors: ["not found"] }, 404);
	}

	const email = await getEmail(c.env.DB, id);
	if (!email)
	{
		return c.json({ errors: ["not found"] }, 404);
	}

	return c.json(toSummary(email));
});

emailRoutes.delete("/:id", async (c) =>
{
	const email = await getEmail(c.env.DB, c.req.param("id"));
	if (!email)
	{
		return c.json({ errors: ["not found"] }, 404);
	}
	if (email.is_deleted !== 1)
	{
		return c.json({ errors: ["email must be in trash"] }, 409);
	}

	const attachments = await listAttachments(c.env.DB, email.id);
	await c.env.BUCKET.delete([email.raw_key, ...attachments.map((attachment) => attachment.r2_key)]);
	await deleteEmail(c.env.DB, email.id);

	return c.body(null, 204);
});
