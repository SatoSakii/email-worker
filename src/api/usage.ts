import { Hono } from "hono";
import { storageUsed } from "../db/emails";
import { MAX_STORAGE } from "../limits";
import type { AppEnv } from "../types";

export const usageRoutes = new Hono<AppEnv>();

usageRoutes.get("/", async (c) =>
{
	return c.json({ used: await storageUsed(c.env.DB), limit: MAX_STORAGE });
});
