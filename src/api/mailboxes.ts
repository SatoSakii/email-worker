import { Hono } from "hono";
import type { Context } from "hono";
import { attachmentKeys, deleteEmails, hasTrashed, listTrashed } from "../db/emails";
import { deleteLock, getLock, insertLock } from "../db/locks";
import type { AppEnv } from "../types";
import { readJsonObject } from "./body";
import { checkPin, hashPin, isValidPin, newSalt, retryAfter } from "./pin";
import type { PinResult } from "./pin";

const ADDRESS = /^[^\s@]+@[^\s@]+$/;

function readAlias(c: Context<AppEnv>): string | null
{
	const alias = c.req.param("alias")?.trim().toLowerCase() ?? "";
	return alias.length <= 254 && ADDRESS.test(alias) ? alias : null;
}

function reply(c: Context<AppEnv>, result: PinResult, onOk: () => Response | Promise<Response>)
{
	if (result.status === "ok")
	{
		return onOk();
	}
	if (result.status === "blocked")
	{
		return c.json({ errors: ["too many attempts"], retry_after: result.retry_after }, 429);
	}
	return c.json({ errors: ["wrong pin"] }, 401);
}

const TRASH_BATCH = 50;

export const mailboxRoutes = new Hono<AppEnv>();

mailboxRoutes.delete("/:alias/trash", async (c) =>
{
	const alias = readAlias(c);
	if (!alias)
	{
		return c.json({ errors: ["invalid alias"] }, 400);
	}

	const trashed = await listTrashed(c.env.DB, alias, TRASH_BATCH);
	if (trashed.length > 0)
	{
		const ids = trashed.map((mail) => mail.id);
		const keys = [...trashed.map((mail) => mail.raw_key), ...await attachmentKeys(c.env.DB, ids)];
		await c.env.BUCKET.delete(keys);
		await deleteEmails(c.env.DB, ids);
	}

	return c.json({ deleted: trashed.length, remaining: await hasTrashed(c.env.DB, alias) });
});

mailboxRoutes.get("/:alias", async (c) =>
{
	const alias = readAlias(c);
	if (!alias)
	{
		return c.json({ errors: ["invalid alias"] }, 400);
	}

	const lock = await getLock(c.env.DB, alias);
	return c.json({ alias, locked: lock !== null, retry_after: lock ? retryAfter(lock, Date.now()) : 0 });
});

mailboxRoutes.put("/:alias/lock", async (c) =>
{
	const alias = readAlias(c);
	if (!alias)
	{
		return c.json({ errors: ["invalid alias"] }, 400);
	}

	const body = await readJsonObject(c.req.raw);
	if (!body || !isValidPin(body.pin))
	{
		return c.json({ errors: ["pin must be 4 to 8 digits"] }, 400);
	}

	const salt = newSalt();
	if (!await insertLock(c.env.DB, alias, await hashPin(body.pin, salt), salt))
	{
		return c.json({ errors: ["already locked"] }, 409);
	}

	return c.json({ alias, locked: true }, 201);
});

mailboxRoutes.post("/:alias/unlock", async (c) =>
{
	const alias = readAlias(c);
	if (!alias)
	{
		return c.json({ errors: ["invalid alias"] }, 400);
	}

	const body = await readJsonObject(c.req.raw);
	if (!body || !isValidPin(body.pin))
	{
		return c.json({ errors: ["pin must be 4 to 8 digits"] }, 400);
	}

	const lock = await getLock(c.env.DB, alias);
	if (!lock)
	{
		return c.json({ errors: ["not locked"] }, 404);
	}

	return reply(c, await checkPin(c.env.DB, lock, body.pin, Date.now()), () => c.json({ ok: true }));
});

mailboxRoutes.delete("/:alias/lock", async (c) =>
{
	const alias = readAlias(c);
	if (!alias)
	{
		return c.json({ errors: ["invalid alias"] }, 400);
	}

	const lock = await getLock(c.env.DB, alias);
	if (!lock)
	{
		return c.json({ errors: ["not locked"] }, 404);
	}

	if ((await c.req.raw.clone().text()).trim() === "")
	{
		await deleteLock(c.env.DB, alias);
		return c.body(null, 204);
	}

	const body = await readJsonObject(c.req.raw);
	if (!body || !isValidPin(body.pin))
	{
		return c.json({ errors: ["pin must be 4 to 8 digits"] }, 400);
	}

	return reply(c, await checkPin(c.env.DB, lock, body.pin, Date.now()), async () =>
	{
		await deleteLock(c.env.DB, alias);
		return c.body(null, 204);
	});
});
