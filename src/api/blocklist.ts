import { Hono } from "hono";
import { addBlocklistEntry, listBlocklist, removeBlocklistEntry } from "../db/blocklist";
import type { AppEnv } from "../types";
import { readJsonObject } from "./body";

const PATTERN = /^(\*|[^\s@*]+)@[^\s@*]+$/;

export const blocklistRoutes = new Hono<AppEnv>();

blocklistRoutes.get("/", async (c) =>
{
	return c.json({ entries: await listBlocklist(c.env.DB) });
});

blocklistRoutes.post("/", async (c) =>
{
	const body = await readJsonObject(c.req.raw);
	if (!body)
	{
		return c.json({ errors: ["invalid request body"] }, 400);
	}

	const { type, pattern: rawPattern } = body;
	if (type !== "sender" && type !== "alias")
	{
		return c.json({ errors: ["type must be sender or alias"] }, 400);
	}

	const pattern = typeof rawPattern === "string" ? rawPattern.trim().toLowerCase() : "";
	if (!PATTERN.test(pattern))
	{
		return c.json({ errors: ["pattern must be an address or *@domain"] }, 400);
	}

	const entry = await addBlocklistEntry(c.env.DB, type, pattern);
	if (!entry)
	{
		return c.json({ errors: ["already blocked"] }, 409);
	}

	return c.json(entry, 201);
});

blocklistRoutes.delete("/:id", async (c) =>
{
	if (!await removeBlocklistEntry(c.env.DB, c.req.param("id")))
	{
		return c.json({ errors: ["not found"] }, 404);
	}

	return c.body(null, 204);
});
