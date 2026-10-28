import { afterEach, describe, expect, it, vi } from "vitest";
import totpKey from "@/pages/api/mailbox/[alias]/totp/[id]";
import totp from "@/pages/api/mailbox/[alias]/totp/index";
import { ALIAS, MAILBOX, MAIL_ID, callApi, json, sessionCookie, stubWorker } from "./helpers";

const OPEN = { "GET /mailboxes/test123%40sato-mail.xyz": () => json({ alias: ALIAS, locked: false, retry_after: 0 }) };
const LOCKED = { "GET /mailboxes/test123%40sato-mail.xyz": () => json({ alias: ALIAS, locked: true, retry_after: 0 }) };
const KEY = { id: MAIL_ID, name: "GitHub", secret: "GEZDGNBVGY3TQOJQ", digits: 6, period: 30, algorithm: "SHA-1" };

afterEach(() => vi.unstubAllGlobals());

describe("GET /api/mailbox/[alias]/totp", () =>
{
	it("lists the keys of an open mailbox", async () =>
	{
		const calls = stubWorker({ ...OPEN, [`GET ${MAILBOX}/totp`]: () => json({ keys: [KEY] }) });

		const result = await callApi(totp, { query: { alias: "test123" } });

		expect(result.status).toBe(200);
		expect(result.json).toEqual({ keys: [KEY] });
		expect(calls.at(-1)?.authorization).toMatch(/^Bearer /);
	});

	it("refuses a locked mailbox without a session and never asks for the keys", async () =>
	{
		const calls = stubWorker({ ...LOCKED, [`GET ${MAILBOX}/totp`]: () => json({ keys: [KEY] }) });

		const result = await callApi(totp, { query: { alias: "test123" } });

		expect(result.status).toBe(403);
		expect(JSON.stringify(result.json)).not.toContain(KEY.secret);
		expect(calls.some((call) => call.path.endsWith("/totp"))).toBe(false);
	});

	it("serves a locked mailbox with a valid session", async () =>
	{
		stubWorker({ ...LOCKED, [`GET ${MAILBOX}/totp`]: () => json({ keys: [KEY] }) });

		const result = await callApi(totp, { query: { alias: "test123" }, cookie: sessionCookie(ALIAS) });

		expect(result.status).toBe(200);
		expect(result.json).toEqual({ keys: [KEY] });
	});

	it("rejects an invalid alias", async () =>
	{
		const result = await callApi(totp, { query: { alias: "bad alias!" } });

		expect(result.status).toBe(400);
	});
});

describe("POST /api/mailbox/[alias]/totp", () =>
{
	it("forwards only the key fields to the worker", async () =>
	{
		const calls = stubWorker({ ...OPEN, [`POST ${MAILBOX}/totp`]: () => json(KEY, 201) });

		const result = await callApi(totp, {
			method: "POST",
			query: { alias: "test123" },
			body: { name: "GitHub", secret: "GEZDGNBVGY3TQOJQ", digits: 6, period: 30, algorithm: "SHA-1", alias: "other@x.com", id: "x" },
		});

		expect(result.status).toBe(201);
		expect(result.json).toEqual(KEY);
		expect(JSON.parse(calls.at(-1)?.body ?? "{}")).toEqual({ name: "GitHub", secret: "GEZDGNBVGY3TQOJQ", digits: 6, period: 30, algorithm: "SHA-1" });
	});

	it("refuses a locked mailbox without a session", async () =>
	{
		const calls = stubWorker(LOCKED);

		const result = await callApi(totp, { method: "POST", query: { alias: "test123" }, body: { name: "A", secret: KEY.secret } });

		expect(result.status).toBe(403);
		expect(calls.some((call) => call.method === "POST")).toBe(false);
	});

	it("passes the worker validation errors through", async () =>
	{
		stubWorker({ ...OPEN, [`POST ${MAILBOX}/totp`]: () => json({ errors: ["secret must be a base32 key"] }, 400) });

		const result = await callApi(totp, { method: "POST", query: { alias: "test123" }, body: { name: "A", secret: "nope" } });

		expect(result.status).toBe(400);
		expect(result.json).toEqual({ errors: ["secret must be a base32 key"] });
	});

	it("rejects a body that is not an object", async () =>
	{
		const result = await callApi(totp, { method: "POST", query: { alias: "test123" }, body: "nope" });

		expect(result.status).toBe(400);
	});

	it("rejects other methods", async () =>
	{
		const result = await callApi(totp, { method: "PUT", query: { alias: "test123" } });

		expect(result.status).toBe(405);
	});
});

describe("DELETE /api/mailbox/[alias]/totp/[id]", () =>
{
	it("removes a key of an open mailbox", async () =>
	{
		const calls = stubWorker({ ...OPEN, [`DELETE ${MAILBOX}/totp/${MAIL_ID}`]: () => new Response(null, { status: 204 }) });

		const result = await callApi(totpKey, { method: "DELETE", query: { alias: "test123", id: MAIL_ID } });

		expect(result.status).toBe(204);
		expect(calls.at(-1)?.method).toBe("DELETE");
	});

	it("refuses a locked mailbox without a session", async () =>
	{
		const calls = stubWorker(LOCKED);

		const result = await callApi(totpKey, { method: "DELETE", query: { alias: "test123", id: MAIL_ID } });

		expect(result.status).toBe(403);
		expect(calls.some((call) => call.method === "DELETE")).toBe(false);
	});

	it("rejects an id that is not a uuid", async () =>
	{
		const result = await callApi(totpKey, { method: "DELETE", query: { alias: "test123", id: "../x" } });

		expect(result.status).toBe(404);
	});

	it("passes a missing key through as 404", async () =>
	{
		stubWorker({ ...OPEN, [`DELETE ${MAILBOX}/totp/${MAIL_ID}`]: () => json({ errors: ["not found"] }, 404) });

		const result = await callApi(totpKey, { method: "DELETE", query: { alias: "test123", id: MAIL_ID } });

		expect(result.status).toBe(404);
	});
});
