import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { matchesPattern } from "../src/email/blocklist";
import { handleEmail } from "../src/email/handler";
import { buildMail, createMessage, queryAll, request, requestJson, resetData } from "./helpers";

async function block(type: string, pattern: string): Promise<void>
{
	const response = await requestJson("/blocklist", "POST", { type, pattern });
	expect(response.status).toBe(201);
}

async function deliver(from: string, to: string, header: string)
{
	const { message, state } = createMessage(from, to, buildMail({ from: header, to }));
	await handleEmail(message, env);
	return state;
}

describe("matchesPattern", () =>
{
	it("matches exact addresses regardless of case", () =>
	{
		expect(matchesPattern("spam@evil.com", "SPAM@Evil.com")).toBe(true);
		expect(matchesPattern("spam@evil.com", "other@evil.com")).toBe(false);
	});

	it("matches a whole domain with a wildcard but not look-alike or sub domains", () =>
	{
		expect(matchesPattern("*@evil.com", "anyone@evil.com")).toBe(true);
		expect(matchesPattern("*@evil.com", "anyone@notevil.com")).toBe(false);
		expect(matchesPattern("*@evil.com", "anyone@sub.evil.com")).toBe(false);
	});
});

describe("blocklist reception", () =>
{
	beforeEach(resetData);

	it("rejects a blocked envelope sender and stores nothing", async () =>
	{
		await block("sender", "spam@evil.com");

		const state = await deliver("Spam@Evil.com", "me@example.org", "Someone <someone@ok.com>");

		expect(state.rejected).toBe("rejected");
		expect(await queryAll("SELECT id FROM emails")).toEqual([]);
		expect((await env.BUCKET.list()).objects).toEqual([]);
	});

	it("rejects a blocked sender seen only in the From header", async () =>
	{
		await block("sender", "*@evil.com");

		const state = await deliver("bounce@mailer.example.net", "me@example.org", "Promo <promo@evil.com>");

		expect(state.rejected).toBe("rejected");
		expect(await queryAll("SELECT id FROM emails")).toEqual([]);
	});

	it("rejects a blocked alias regardless of case", async () =>
	{
		await block("alias", "spam@me.org");

		const state = await deliver("a@ok.com", "SPAM@Me.org", "a@ok.com");

		expect(state.rejected).toBe("rejected");
	});

	it("does not mix sender and alias entries", async () =>
	{
		await block("alias", "a@ok.com");

		const state = await deliver("a@ok.com", "me@example.org", "a@ok.com");

		expect(state.rejected).toBeNull();
		expect(await queryAll("SELECT id FROM emails")).toHaveLength(1);
	});

	it("accepts unrelated mails", async () =>
	{
		await block("sender", "spam@evil.com");

		const state = await deliver("friend@ok.com", "me@example.org", "friend@ok.com");

		expect(state.rejected).toBeNull();
	});
});

describe("blocklist routes", () =>
{
	beforeEach(resetData);

	it("adds, lists and removes entries", async () =>
	{
		const created = await requestJson("/blocklist", "POST", { type: "sender", pattern: "  Spam@Evil.com " });
		expect(created.status).toBe(201);
		const entry = await created.json() as { id: string; type: string; pattern: string };
		expect(entry).toMatchObject({ type: "sender", pattern: "spam@evil.com" });

		const listed = await (await request("/blocklist")).json() as { entries: { id: string }[] };
		expect(listed.entries.map((item) => item.id)).toEqual([entry.id]);

		expect((await request(`/blocklist/${entry.id}`, { method: "DELETE" })).status).toBe(204);
		expect((await request(`/blocklist/${entry.id}`, { method: "DELETE" })).status).toBe(404);
	});

	it("rejects duplicates", async () =>
	{
		await block("sender", "spam@evil.com");

		expect((await requestJson("/blocklist", "POST", { type: "sender", pattern: "SPAM@evil.com" })).status).toBe(409);
	});

	it.each([
		[{ type: "bogus", pattern: "a@b.c" }],
		[{ type: "sender", pattern: "not-an-address" }],
		[{ type: "sender", pattern: "a@b@c.d" }],
		[{ type: "sender", pattern: "*@*.com" }],
		[{ type: "sender", pattern: 42 }],
		[{ type: "sender" }],
		[[]],
		[null],
	])("rejects invalid body %j", async (body) =>
	{
		expect((await requestJson("/blocklist", "POST", body)).status).toBe(400);
	});

	it("rejects a body that is not json", async () =>
	{
		const response = await request("/blocklist", { method: "POST", body: "{nope" });
		expect(response.status).toBe(400);
	});
});
