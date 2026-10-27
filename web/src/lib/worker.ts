import { readConfig } from "./config";
import type { FlagPatch, Folder, MailDetail, MailPage, MailSummary } from "./types";

export class WorkerError extends Error
{
	status: number;
	body: Record<string, unknown>;

	constructor(status: number, body: Record<string, unknown> = {})
	{
		super(`worker answered ${status}`);
		this.status = status;
		this.body = body;
	}
}

export async function callWorker(path: string, init: RequestInit = {}): Promise<Response>
{
	const { workerUrl, apiToken } = readConfig();
	const headers = new Headers(init.headers);
	headers.set("Authorization", `Bearer ${apiToken}`);

	try
	{
		return await fetch(`${workerUrl}${path}`, { ...init, headers, cache: "no-store" });
	}
	catch (_error)
	{
		throw new WorkerError(502);
	}
}

async function expectOk(response: Response): Promise<Response>
{
	if (!response.ok)
	{
		const body = await response.json().catch(() => ({})) as Record<string, unknown>;
		throw new WorkerError(response.status, body);
	}
	return response;
}

async function workerJson<T>(path: string, init: RequestInit = {}): Promise<T>
{
	const response = await expectOk(await callWorker(path, init));
	return await response.json() as T;
}

function withJson(method: string, body: unknown): RequestInit
{
	return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function mailboxPath(alias: string, suffix = ""): string
{
	return `/mailboxes/${encodeURIComponent(alias)}${suffix}`;
}

export async function getMailbox(alias: string): Promise<{ alias: string; locked: boolean; retry_after: number }>
{
	return await workerJson(mailboxPath(alias));
}

export async function lockMailbox(alias: string, pin: string): Promise<void>
{
	await expectOk(await callWorker(mailboxPath(alias, "/lock"), withJson("PUT", { pin })));
}

export async function unlockMailbox(alias: string, pin: string): Promise<void>
{
	await expectOk(await callWorker(mailboxPath(alias, "/unlock"), withJson("POST", { pin })));
}

export async function removeLock(alias: string, pin: string): Promise<void>
{
	await expectOk(await callWorker(mailboxPath(alias, "/lock"), withJson("DELETE", { pin })));
}

export interface ListOptions
{
	folder: Folder;
	q?: string;
	cursor?: string;
	limit: number;
}

export async function listMail(alias: string, options: ListOptions): Promise<MailPage>
{
	const query = new URLSearchParams({ alias, limit: String(options.limit) });
	if (options.folder === "starred")
	{
		query.set("starred", "1");
	}
	if (options.folder === "trash")
	{
		query.set("trash", "1");
	}
	if (options.q)
	{
		query.set("q", options.q);
	}
	if (options.cursor)
	{
		query.set("cursor", options.cursor);
	}

	return await workerJson(`/emails?${query.toString()}`);
}

export async function getMail(id: string): Promise<MailDetail>
{
	return await workerJson(`/emails/${id}`);
}

export async function patchMail(id: string, patch: FlagPatch): Promise<MailSummary>
{
	return await workerJson(`/emails/${id}`, withJson("PATCH", patch));
}

export async function fetchAttachment(id: string): Promise<Response>
{
	return await expectOk(await callWorker(`/attachments/${encodeURIComponent(id)}`));
}
