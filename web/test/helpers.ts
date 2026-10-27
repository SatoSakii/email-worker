import type { NextApiHandler } from "next";
import { vi } from "vitest";
import { encodeSession } from "@/lib/session";

export const SECRET = "test-session-secret-0123456789abcdef";
export const ALIAS = "test123@sato-mail.xyz";
export const MAILBOX = "/mailboxes/test123%40sato-mail.xyz";
export const MAIL_ID = "6a7e26ca-51dc-4c05-bc73-ada7f867200b";

export interface WorkerCall
{
	method: string;
	path: string;
	query: URLSearchParams;
	authorization: string | null;
	body: string | null;
}

export type WorkerHandler = (call: WorkerCall) => Response;

export function json(body: unknown, status = 200): Response
{
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function stubWorker(handlers: Record<string, WorkerHandler>): WorkerCall[]
{
	const calls: WorkerCall[] = [];

	vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) =>
	{
		const url = new URL(String(input));
		const headers = new Headers(init.headers);
		const call: WorkerCall = {
			method: init.method ?? "GET",
			path: url.pathname,
			query: url.searchParams,
			authorization: headers.get("Authorization"),
			body: typeof init.body === "string" ? init.body : null,
		};
		calls.push(call);

		const handler = handlers[`${call.method} ${call.path}`];
		if (!handler)
		{
			throw new Error(`unexpected worker call: ${call.method} ${call.path}`);
		}
		return handler(call);
	});

	return calls;
}

export interface CallOptions
{
	method?: string;
	query?: Record<string, string | string[]>;
	body?: unknown;
	cookie?: string;
}

export interface CallResult
{
	status: number;
	json: Record<string, unknown>;
	headers: Record<string, string | string[]>;
	raw: Buffer | null;
}

export async function callApi(handler: NextApiHandler, options: CallOptions = {}): Promise<CallResult>
{
	const headers: Record<string, string | string[]> = {};
	let status = 200;
	let payload: unknown = null;
	let raw: Buffer | null = null;

	const request = {
		method: options.method ?? "GET",
		query: options.query ?? {},
		body: options.body,
		headers: options.cookie ? { cookie: options.cookie } : {},
	};
	const response = {
		setHeader(name: string, value: string | string[])
		{
			headers[name.toLowerCase()] = value;
			return response;
		},
		getHeader(name: string)
		{
			return headers[name.toLowerCase()];
		},
		status(code: number)
		{
			status = code;
			return response;
		},
		json(value: unknown)
		{
			payload = value;
			return response;
		},
		send(value: Buffer | string)
		{
			raw = Buffer.from(value);
			return response;
		},
		end()
		{
			return response;
		},
	};

	await handler(request as never, response as never);

	return { status, json: (payload ?? {}) as Record<string, unknown>, headers, raw };
}

export function sessionCookie(...aliases: string[]): string
{
	return `mb=${encodeSession(aliases, SECRET)}`;
}

export function cookieAliases(result: CallResult, decode: (value: string) => string[]): string[]
{
	const header = String(result.headers["set-cookie"] ?? "");
	const match = /^mb=([^;]+)/.exec(header);
	return match ? decode(match[1]) : [];
}

export function summary(overrides: Record<string, unknown> = {}): Record<string, unknown>
{
	return {
		id: MAIL_ID,
		from_address: "alessio.bernard34@gmail.com",
		from_name: "Alessio",
		to_address: ALIAS,
		subject: "secret subject",
		received_at: 1793127683466,
		size: 7115,
		is_read: false,
		is_starred: false,
		is_deleted: false,
		has_attachments: false,
		parse_failed: false,
		...overrides,
	};
}

export function detail(overrides: Record<string, unknown> = {}): Record<string, unknown>
{
	return {
		...summary(),
		message_id: "<id@x>",
		text_body: "secret body",
		html_body: "",
		attachments: [{ id: "att-1", filename: "a.txt", content_type: "text/plain", size: 3 }],
		...overrides,
	};
}
