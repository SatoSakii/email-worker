import type { Context, Next } from "hono";
import type { AppEnv } from "../types";

async function digest(value: string): Promise<Uint8Array>
{
	return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function requireToken(c: Context<AppEnv>, next: Next): Promise<Response | void>
{
	const match = /^Bearer (.+)$/.exec(c.req.header("Authorization") ?? "");
	if (!match || !c.env.API_TOKEN)
	{
		return c.json({ errors: ["unauthorized"] }, 401);
	}

	const [given, expected] = await Promise.all([digest(match[1]), digest(c.env.API_TOKEN)]);
	if (!crypto.subtle.timingSafeEqual(given, expected))
	{
		return c.json({ errors: ["unauthorized"] }, 401);
	}

	await next();
}
