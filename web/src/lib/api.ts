import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { toAlias } from "./alias";
import { readConfig } from "./config";
import { readAliases, writeAliases } from "./session";
import type { MailDetail } from "./types";
import { WorkerError, getMail, getMailbox } from "./worker";

type Handler = (req: NextApiRequest, res: NextApiResponse) => Promise<void>;

const PASSTHROUGH = [400, 401, 404, 409, 429];
const MAIL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PIN = /^\d{4,8}$/;

function fail(res: NextApiResponse, error: unknown): void
{
	if (error instanceof WorkerError)
	{
		if (!PASSTHROUGH.includes(error.status))
		{
			res.status(502).json({ errors: ["upstream error"] });
			return;
		}

		const errors = Array.isArray(error.body.errors) ? error.body.errors.filter((item) => typeof item === "string") : ["request failed"];
		const body: Record<string, unknown> = { errors };
		if (typeof error.body.retry_after === "number")
		{
			body.retry_after = error.body.retry_after;
		}
		res.status(error.status).json(body);
		return;
	}

	console.error(error);
	res.status(500).json({ errors: ["internal error"] });
}

export function route(methods: Partial<Record<string, Handler>>): NextApiHandler
{
	return async (req, res) =>
	{
		res.setHeader("Cache-Control", "no-store");

		const handler = methods[req.method ?? ""];
		if (!handler)
		{
			res.setHeader("Allow", Object.keys(methods).join(", "));
			res.status(405).json({ errors: ["method not allowed"] });
			return;
		}

		try
		{
			await handler(req, res);
		}
		catch (error)
		{
			fail(res, error);
		}
	};
}

export function first(value: string | string[] | undefined): string | undefined
{
	return Array.isArray(value) ? value[0] : value;
}

export function readAlias(req: NextApiRequest, res: NextApiResponse): string | null
{
	const alias = toAlias(first(req.query.alias) ?? "", readConfig().mailDomain);
	if (!alias)
	{
		res.status(400).json({ errors: ["invalid alias"] });
	}
	return alias;
}

export function readId(req: NextApiRequest, res: NextApiResponse): string | null
{
	const id = first(req.query.id) ?? "";
	if (!MAIL_ID.test(id))
	{
		res.status(404).json({ errors: ["not found"] });
		return null;
	}
	return id;
}

export function readPin(req: NextApiRequest): string | null
{
	const body = req.body as { pin?: unknown } | null | undefined;
	return typeof body === "object" && body !== null && typeof body.pin === "string" && PIN.test(body.pin) ? body.pin : null;
}

export function openAliases(req: NextApiRequest): string[]
{
	return readAliases(req, readConfig().sessionSecret);
}

export function saveAliases(res: NextApiResponse, aliases: string[]): void
{
	writeAliases(res, aliases, readConfig().sessionSecret);
}

export async function requireAccess(req: NextApiRequest, res: NextApiResponse, alias: string): Promise<boolean>
{
	if (openAliases(req).includes(alias))
	{
		return true;
	}

	const mailbox = await getMailbox(alias);
	if (!mailbox.locked)
	{
		return true;
	}

	res.status(403).json({ errors: ["mailbox is locked"], locked: true, retry_after: mailbox.retry_after });
	return false;
}

export async function loadMail(req: NextApiRequest, res: NextApiResponse): Promise<MailDetail | null>
{
	const id = readId(req, res);
	if (!id)
	{
		return null;
	}

	const mail = await getMail(id);
	if (!await requireAccess(req, res, mail.to_address.toLowerCase()))
	{
		return null;
	}

	return mail;
}
