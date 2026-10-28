import { Hono } from "hono";
import type { Context } from "hono";
import { countTotp, deleteTotp, insertTotp, listTotp } from "../db/totp";
import type { NewTotp, TotpRow } from "../db/totp";
import type { AppEnv } from "../types";
import { readJsonObject } from "./body";

const ADDRESS = /^[^\s@]+@[^\s@]+$/;
const BASE32 = /^[A-Z2-7]{8,256}$/;
const ALGORITHMS = ["SHA-1", "SHA-256", "SHA-512"];
const MAX_KEYS = 50;
const MAX_NAME = 60;

function readAlias(c: Context<AppEnv>): string | null
{
	const alias = c.req.param("alias")?.trim().toLowerCase() ?? "";
	return alias.length <= 254 && ADDRESS.test(alias) ? alias : null;
}

function present(row: TotpRow)
{
	return { id: row.id, name: row.name, secret: row.secret, digits: row.digits, period: row.period, algorithm: row.algorithm };
}

function readKey(body: Record<string, unknown>): NewTotp | string
{
	const name = typeof body.name === "string" ? body.name.trim() : "";
	if (name === "" || name.length > MAX_NAME)
	{
		return `name must be 1 to ${MAX_NAME} characters`;
	}

	const secret = typeof body.secret === "string" ? body.secret.replace(/[\s=-]/g, "").toUpperCase() : "";
	if (!BASE32.test(secret))
	{
		return "secret must be a base32 key";
	}

	const digits = body.digits ?? 6;
	if (typeof digits !== "number" || !Number.isInteger(digits) || digits < 6 || digits > 8)
	{
		return "digits must be 6 to 8";
	}

	const period = body.period ?? 30;
	if (typeof period !== "number" || !Number.isInteger(period) || period < 1 || period > 300)
	{
		return "period must be 1 to 300";
	}

	const algorithm = body.algorithm ?? "SHA-1";
	if (typeof algorithm !== "string" || !ALGORITHMS.includes(algorithm))
	{
		return "algorithm must be SHA-1, SHA-256 or SHA-512";
	}

	return { name, secret, digits, period, algorithm };
}

export const totpRoutes = new Hono<AppEnv>();

totpRoutes.get("/:alias/totp", async (c) =>
{
	const alias = readAlias(c);
	if (!alias)
	{
		return c.json({ errors: ["invalid alias"] }, 400);
	}

	return c.json({ keys: (await listTotp(c.env.DB, alias)).map(present) });
});

totpRoutes.post("/:alias/totp", async (c) =>
{
	const alias = readAlias(c);
	if (!alias)
	{
		return c.json({ errors: ["invalid alias"] }, 400);
	}

	const body = await readJsonObject(c.req.raw);
	if (!body)
	{
		return c.json({ errors: ["invalid json body"] }, 400);
	}

	const key = readKey(body);
	if (typeof key === "string")
	{
		return c.json({ errors: [key] }, 400);
	}

	if (await countTotp(c.env.DB, alias) >= MAX_KEYS)
	{
		return c.json({ errors: ["too many keys"] }, 409);
	}

	return c.json(present(await insertTotp(c.env.DB, alias, key)), 201);
});

totpRoutes.delete("/:alias/totp/:id", async (c) =>
{
	const alias = readAlias(c);
	if (!alias)
	{
		return c.json({ errors: ["invalid alias"] }, 400);
	}

	if (!await deleteTotp(c.env.DB, alias, c.req.param("id")))
	{
		return c.json({ errors: ["not found"] }, 404);
	}

	return c.body(null, 204);
});
