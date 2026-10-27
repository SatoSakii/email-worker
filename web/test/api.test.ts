import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeSession } from "@/lib/session";
import attachment from "@/pages/api/emails/[id]/attachments/[aid]";
import mail from "@/pages/api/emails/[id]/index";
import list from "@/pages/api/mailbox/[alias]/emails";
import mailbox from "@/pages/api/mailbox/[alias]/index";
import lock from "@/pages/api/mailbox/[alias]/lock";
import unlock from "@/pages/api/mailbox/[alias]/unlock";
import { ALIAS, MAILBOX, MAIL_ID, SECRET, callApi, cookieAliases, detail, json, sessionCookie, stubWorker, summary } from "./helpers";

const decode = (value: string) => decodeSession(value, SECRET);
const OPEN = { "GET /mailboxes/test123%40sato-mail.xyz": () => json({ alias: ALIAS, locked: false, retry_after: 0 }) };
const LOCKED = { "GET /mailboxes/test123%40sato-mail.xyz": () => json({ alias: ALIAS, locked: true, retry_after: 0 }) };

afterEach(() => vi.unstubAllGlobals());

describe("GET /api/mailbox/[alias]", () =>
{
	it("reports an open mailbox as unlocked", async () =>
	{
		stubWorker(OPEN);

		const result = await callApi(mailbox, { query: { alias: "test123" } });

		expect(result.status).toBe(200);
		expect(result.json).toEqual({ alias: ALIAS, locked: false, unlocked: true, retry_after: 0 });
	});

	it("reports a locked mailbox as closed without a session", async () =>
	{
		stubWorker(LOCKED);

		const result = await callApi(mailbox, { query: { alias: "test123" } });

		expect(result.json).toMatchObject({ locked: true, unlocked: false });
	});

	it("reports a locked mailbox as open with a valid session", async () =>
	{
		stubWorker(LOCKED);

		const result = await callApi(mailbox, { query: { alias: "test123" }, cookie: sessionCookie(ALIAS) });

		expect(result.json).toMatchObject({ locked: true, unlocked: true });
	});

	it("normalizes the typed alias", async () =>
	{
		stubWorker(OPEN);

		const result = await callApi(mailbox, { query: { alias: "  TEST123 " } });

		expect(result.json.alias).toBe(ALIAS);
	});

	it.each(["a b", "", "a@other.com", "../x"])("rejects the alias %j without calling the worker", async (alias) =>
	{
		const calls = stubWorker({});

		const result = await callApi(mailbox, { query: { alias } });

		expect(result.status).toBe(400);
		expect(calls).toEqual([]);
	});

	it("authenticates to the worker but never exposes the token", async () =>
	{
		const calls = stubWorker(OPEN);

		const result = await callApi(mailbox, { query: { alias: "test123" } });

		expect(calls[0].authorization).toBe("Bearer secret-worker-token");
		expect(JSON.stringify(result)).not.toContain("secret-worker-token");
	});

	it("refuses other methods", async () =>
	{
		const result = await callApi(mailbox, { method: "POST", query: { alias: "test123" } });

		expect(result.status).toBe(405);
	});

	it("never lets the browser cache mailbox data", async () =>
	{
		stubWorker(OPEN);

		const result = await callApi(mailbox, { query: { alias: "test123" } });

		expect(result.headers["cache-control"]).toBe("no-store");
	});
});

describe("GET /api/mailbox/[alias]/emails", () =>
{
	const page = { emails: [summary()], next_cursor: null };

	it("lists the mails of the alias", async () =>
	{
		const calls = stubWorker({ ...OPEN, "GET /emails": () => json(page) });

		const result = await callApi(list, { query: { alias: "test123" } });
		const request = calls[1];

		expect(result.status).toBe(200);
		expect(result.json).toEqual(page);
		expect(request.query.get("alias")).toBe(ALIAS);
		expect(request.query.get("limit")).toBe("30");
		expect(request.query.get("trash")).toBeNull();
		expect(request.query.get("starred")).toBeNull();
	});

	it.each([
		["starred", "starred", "1"],
		["trash", "trash", "1"],
	])("maps the %s folder to the worker filter", async (folder, name, value) =>
	{
		const calls = stubWorker({ ...OPEN, "GET /emails": () => json(page) });

		await callApi(list, { query: { alias: "test123", folder } });

		expect(calls[1].query.get(name)).toBe(value);
	});

	it("forwards the search and the cursor", async () =>
	{
		const calls = stubWorker({ ...OPEN, "GET /emails": () => json(page) });

		await callApi(list, { query: { alias: "test123", q: "invoice march", cursor: "1000:abc" } });

		expect(calls[1].query.get("q")).toBe("invoice march");
		expect(calls[1].query.get("cursor")).toBe("1000:abc");
	});

	it("rejects an unknown folder", async () =>
	{
		const calls = stubWorker({ ...OPEN, "GET /emails": () => json(page) });

		const result = await callApi(list, { query: { alias: "test123", folder: "all" } });

		expect(result.status).toBe(400);
		expect(calls.some((call) => call.path === "/emails")).toBe(false);
	});

	it("refuses a locked mailbox without a session and never asks for its mails", async () =>
	{
		const calls = stubWorker({ ...LOCKED, "GET /emails": () => json(page) });

		const result = await callApi(list, { query: { alias: "test123" } });

		expect(result.status).toBe(403);
		expect(result.json.locked).toBe(true);
		expect(JSON.stringify(result)).not.toContain("secret subject");
		expect(calls.some((call) => call.path === "/emails")).toBe(false);
	});

	it("serves a locked mailbox with a valid session", async () =>
	{
		stubWorker({ ...LOCKED, "GET /emails": () => json(page) });

		const result = await callApi(list, { query: { alias: "test123" }, cookie: sessionCookie(ALIAS) });

		expect(result.status).toBe(200);
	});

	it("ignores a session for another alias", async () =>
	{
		stubWorker({ ...LOCKED, "GET /emails": () => json(page) });

		const result = await callApi(list, { query: { alias: "test123" }, cookie: sessionCookie("other@sato-mail.xyz") });

		expect(result.status).toBe(403);
	});

	it("ignores a tampered session", async () =>
	{
		stubWorker({ ...LOCKED, "GET /emails": () => json(page) });
		const forged = `mb=${Buffer.from(JSON.stringify({ a: [ALIAS], e: 99999999999999 })).toString("base64url")}.AAAA`;

		const result = await callApi(list, { query: { alias: "test123" }, cookie: forged });

		expect(result.status).toBe(403);
	});
});

describe("/api/emails/[id]", () =>
{
	const withMail = (to = ALIAS) => ({ [`GET /emails/${MAIL_ID}`]: () => json(detail({ to_address: to })) });

	it("returns the mail of an open mailbox", async () =>
	{
		stubWorker({ ...OPEN, ...withMail() });

		const result = await callApi(mail, { query: { id: MAIL_ID } });

		expect(result.status).toBe(200);
		expect(result.json.text_body).toBe("secret body");
	});

	it("does not leak a mail of a locked mailbox", async () =>
	{
		stubWorker({ ...LOCKED, ...withMail() });

		const result = await callApi(mail, { query: { id: MAIL_ID } });

		expect(result.status).toBe(403);
		expect(JSON.stringify(result)).not.toContain("secret");
	});

	it("serves a mail of a locked mailbox with the session", async () =>
	{
		stubWorker({ ...LOCKED, ...withMail() });

		const result = await callApi(mail, { query: { id: MAIL_ID }, cookie: sessionCookie(ALIAS) });

		expect(result.status).toBe(200);
	});

	it("returns 404 when the worker does not know the mail", async () =>
	{
		stubWorker({ [`GET /emails/${MAIL_ID}`]: () => json({ errors: ["not found"] }, 404) });

		const result = await callApi(mail, { query: { id: MAIL_ID } });

		expect(result.status).toBe(404);
	});

	it.each(["unknown", "../mailboxes/x", "", "6a7e26ca"])("returns 404 for the malformed id %j without calling the worker", async (id) =>
	{
		const calls = stubWorker({});

		const result = await callApi(mail, { query: { id } });

		expect(result.status).toBe(404);
		expect(calls).toEqual([]);
	});

	it("updates the flags and forwards only booleans from the allowed keys", async () =>
	{
		const calls = stubWorker({
			...OPEN,
			...withMail(),
			[`PATCH /emails/${MAIL_ID}`]: () => json(summary({ is_read: true })),
		});

		const result = await callApi(mail, { method: "PATCH", query: { id: MAIL_ID }, body: { is_read: true, to_address: "evil@x.com", is_starred: undefined } });
		const patch = calls.find((call) => call.method === "PATCH");

		expect(result.status).toBe(200);
		expect(JSON.parse(patch?.body ?? "{}")).toEqual({ is_read: true });
	});

	it.each([
		[{ is_read: 1 }],
		[{ is_read: "true" }],
		[{}],
		[{ unknown: true }],
		[null],
	])("rejects the invalid patch %j without calling the worker", async (body) =>
	{
		const calls = stubWorker({ ...OPEN, ...withMail() });

		const result = await callApi(mail, { method: "PATCH", query: { id: MAIL_ID }, body });

		expect(result.status).toBe(400);
		expect(calls.some((call) => call.method === "PATCH")).toBe(false);
	});

	it("refuses to update a mail of a locked mailbox", async () =>
	{
		const calls = stubWorker({ ...LOCKED, ...withMail(), [`PATCH /emails/${MAIL_ID}`]: () => json(summary()) });

		const result = await callApi(mail, { method: "PATCH", query: { id: MAIL_ID }, body: { is_read: true } });

		expect(result.status).toBe(403);
		expect(calls.some((call) => call.method === "PATCH")).toBe(false);
	});

	it("offers no permanent deletion", async () =>
	{
		const calls = stubWorker({ ...OPEN, ...withMail() });

		const result = await callApi(mail, { method: "DELETE", query: { id: MAIL_ID } });

		expect(result.status).toBe(405);
		expect(calls.some((call) => call.method === "DELETE")).toBe(false);
	});
});

describe("/api/emails/[id]/attachments/[aid]", () =>
{
	const handlers = (to = ALIAS) => ({
		[`GET /emails/${MAIL_ID}`]: () => json(detail({ to_address: to })),
		"GET /attachments/att-1": () => new Response("abc", { headers: { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename*=UTF-8''a.txt" } }),
	});

	it("downloads an attachment of the mail with safe headers", async () =>
	{
		stubWorker({ ...OPEN, ...handlers() });

		const result = await callApi(attachment, { query: { id: MAIL_ID, aid: "att-1" } });

		expect(result.status).toBe(200);
		expect(result.raw?.toString()).toBe("abc");
		expect(result.headers["content-disposition"]).toBe("attachment; filename*=UTF-8''a.txt");
		expect(result.headers["x-content-type-options"]).toBe("nosniff");
		expect(result.headers["content-security-policy"]).toBe("sandbox");
	});

	it("refuses an attachment that does not belong to the mail and never fetches it", async () =>
	{
		const calls = stubWorker({ ...OPEN, ...handlers(), "GET /attachments/other": () => new Response("nope") });

		const result = await callApi(attachment, { query: { id: MAIL_ID, aid: "other" } });

		expect(result.status).toBe(404);
		expect(calls.some((call) => call.path === "/attachments/other")).toBe(false);
	});

	it("refuses an attachment of a locked mailbox", async () =>
	{
		const calls = stubWorker({ ...LOCKED, ...handlers() });

		const result = await callApi(attachment, { query: { id: MAIL_ID, aid: "att-1" } });

		expect(result.status).toBe(403);
		expect(calls.some((call) => call.path.startsWith("/attachments"))).toBe(false);
	});
});

describe("POST /api/mailbox/[alias]/unlock", () =>
{
	const UNLOCK = `POST ${MAILBOX}/unlock`;

	it("opens the mailbox and remembers it in a signed cookie", async () =>
	{
		const calls = stubWorker({ [UNLOCK]: () => json({ ok: true }) });

		const result = await callApi(unlock, { method: "POST", query: { alias: "test123" }, body: { pin: "1234" } });
		const header = String(result.headers["set-cookie"]);

		expect(result.status).toBe(200);
		expect(JSON.parse(calls[0].body ?? "{}")).toEqual({ pin: "1234" });
		expect(header).toContain("HttpOnly");
		expect(header).toContain("SameSite=Strict");
		expect(cookieAliases(result, decode)).toEqual([ALIAS]);
	});

	it("keeps the aliases that were already open", async () =>
	{
		stubWorker({ [UNLOCK]: () => json({ ok: true }) });

		const result = await callApi(unlock, { method: "POST", query: { alias: "test123" }, body: { pin: "1234" }, cookie: sessionCookie("old@sato-mail.xyz") });

		expect(cookieAliases(result, decode)).toEqual(["old@sato-mail.xyz", ALIAS]);
	});

	it("refuses a wrong pin without opening anything", async () =>
	{
		stubWorker({ [UNLOCK]: () => json({ errors: ["wrong pin"] }, 401) });

		const result = await callApi(unlock, { method: "POST", query: { alias: "test123" }, body: { pin: "0000" } });

		expect(result.status).toBe(401);
		expect(result.headers["set-cookie"]).toBeUndefined();
	});

	it("passes the waiting time when the mailbox is blocked", async () =>
	{
		stubWorker({ [UNLOCK]: () => json({ errors: ["too many attempts"], retry_after: 900 }, 429) });

		const result = await callApi(unlock, { method: "POST", query: { alias: "test123" }, body: { pin: "0000" } });

		expect(result.status).toBe(429);
		expect(result.json.retry_after).toBe(900);
		expect(result.headers["set-cookie"]).toBeUndefined();
	});

	it.each(["abc", "123", "123456789", 1234, null, undefined])("rejects the pin %j without calling the worker", async (pin) =>
	{
		const calls = stubWorker({ [UNLOCK]: () => json({ ok: true }) });

		const result = await callApi(unlock, { method: "POST", query: { alias: "test123" }, body: { pin } });

		expect(result.status).toBe(400);
		expect(calls).toEqual([]);
	});

	it("closes the mailbox again on DELETE without calling the worker", async () =>
	{
		const calls = stubWorker({});

		const result = await callApi(unlock, { method: "DELETE", query: { alias: "test123" }, cookie: sessionCookie(ALIAS, "keep@sato-mail.xyz") });

		expect(result.status).toBe(204);
		expect(cookieAliases(result, decode)).toEqual(["keep@sato-mail.xyz"]);
		expect(calls).toEqual([]);
	});
});

describe("/api/mailbox/[alias]/lock", () =>
{
	const LOCK = `PUT ${MAILBOX}/lock`;
	const UNLOCK = `DELETE ${MAILBOX}/lock`;

	it("locks the mailbox and keeps it open for whoever set the pin", async () =>
	{
		stubWorker({ [LOCK]: () => json({ alias: ALIAS, locked: true }, 201) });

		const result = await callApi(lock, { method: "PUT", query: { alias: "test123" }, body: { pin: "1234" } });

		expect(result.status).toBe(201);
		expect(cookieAliases(result, decode)).toEqual([ALIAS]);
	});

	it("tells when the mailbox already has a pin", async () =>
	{
		stubWorker({ [LOCK]: () => json({ errors: ["already locked"] }, 409) });

		const result = await callApi(lock, { method: "PUT", query: { alias: "test123" }, body: { pin: "1234" } });

		expect(result.status).toBe(409);
		expect(result.headers["set-cookie"]).toBeUndefined();
	});

	it("removes the pin with the right one and closes the session for that alias", async () =>
	{
		const calls = stubWorker({ [UNLOCK]: () => new Response(null, { status: 204 }) });

		const result = await callApi(lock, { method: "DELETE", query: { alias: "test123" }, body: { pin: "1234" }, cookie: sessionCookie(ALIAS) });

		expect(result.status).toBe(204);
		expect(JSON.parse(calls[0].body ?? "{}")).toEqual({ pin: "1234" });
		expect(cookieAliases(result, decode)).toEqual([]);
	});

	it("never forces the removal of a pin from the web", async () =>
	{
		const calls = stubWorker({ [UNLOCK]: () => new Response(null, { status: 204 }) });

		const result = await callApi(lock, { method: "DELETE", query: { alias: "test123" }, cookie: sessionCookie(ALIAS) });

		expect(result.status).toBe(400);
		expect(calls).toEqual([]);
	});

	it("keeps the pin when the one given is wrong", async () =>
	{
		stubWorker({ [UNLOCK]: () => json({ errors: ["wrong pin"] }, 401) });

		const result = await callApi(lock, { method: "DELETE", query: { alias: "test123" }, body: { pin: "0000" } });

		expect(result.status).toBe(401);
	});

	it.each(["abc", "12", 1234, null])("rejects the pin %j when locking", async (pin) =>
	{
		const calls = stubWorker({ [LOCK]: () => json({}, 201) });

		const result = await callApi(lock, { method: "PUT", query: { alias: "test123" }, body: { pin } });

		expect(result.status).toBe(400);
		expect(calls).toEqual([]);
	});
});

describe("worker failures", () =>
{
	it("answers 502 when the worker fails", async () =>
	{
		stubWorker({ "GET /mailboxes/test123%40sato-mail.xyz": () => json({ errors: ["internal error"] }, 500) });

		const result = await callApi(mailbox, { query: { alias: "test123" } });

		expect(result.status).toBe(502);
		expect(result.json.errors).toEqual(["upstream error"]);
	});

	it("answers 502 when the worker is unreachable", async () =>
	{
		vi.stubGlobal("fetch", async () =>
		{
			throw new TypeError("fetch failed");
		});

		const result = await callApi(mailbox, { query: { alias: "test123" } });

		expect(result.status).toBe(502);
	});
});
