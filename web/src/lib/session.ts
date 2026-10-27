import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const COOKIE = "mb";
const LIFETIME_MS = 1000 * 60 * 60 * 8;
const MAX_ALIASES = 20;

function sign(payload: string, secret: string): string
{
	return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function encodeSession(aliases: string[], secret: string, now = Date.now()): string
{
	const payload = Buffer.from(JSON.stringify({ a: aliases.slice(-MAX_ALIASES), e: now + LIFETIME_MS })).toString("base64url");
	return `${payload}.${sign(payload, secret)}`;
}

export function decodeSession(value: string | undefined, secret: string, now = Date.now()): string[]
{
	const parts = (value ?? "").split(".");
	if (parts.length !== 2 || parts[0] === "" || parts[1] === "")
	{
		return [];
	}

	const [payload, signature] = parts;
	const expected = Buffer.from(sign(payload, secret));
	const given = Buffer.from(signature);
	if (given.length !== expected.length || !timingSafeEqual(given, expected))
	{
		return [];
	}

	try
	{
		const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { a?: unknown; e?: unknown };
		if (typeof data.e !== "number" || data.e <= now || !Array.isArray(data.a))
		{
			return [];
		}
		return data.a.filter((alias): alias is string => typeof alias === "string").slice(-MAX_ALIASES);
	}
	catch (_error)
	{
		return [];
	}
}

function readCookie(request: IncomingMessage): string | undefined
{
	const header = request.headers.cookie ?? "";
	for (const part of header.split(";"))
	{
		const [name, ...rest] = part.trim().split("=");
		if (name === COOKIE)
		{
			return rest.join("=");
		}
	}
	return undefined;
}

export function readAliases(request: IncomingMessage, secret: string): string[]
{
	return decodeSession(readCookie(request), secret);
}

export function writeAliases(response: ServerResponse, aliases: string[], secret: string): void
{
	const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
	const maxAge = LIFETIME_MS / 1000;
	response.setHeader("Set-Cookie", `${COOKIE}=${encodeSession(aliases, secret)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
}
