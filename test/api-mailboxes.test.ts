import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { queryAll, request, requestJson, resetData } from "./helpers";

const ALIAS = "test123@sato-mail.xyz";

function path(alias: string, suffix = ""): string
{
	return `/mailboxes/${encodeURIComponent(alias)}${suffix}`;
}

async function lock(alias: string, pin: string): Promise<Response>
{
	return requestJson(path(alias, "/lock"), "PUT", { pin });
}

async function unlock(alias: string, pin: unknown): Promise<Response>
{
	return requestJson(path(alias, "/unlock"), "POST", { pin });
}

describe("GET /mailboxes/:alias", () =>
{
	beforeEach(resetData);

	it("reports an unlocked mailbox", async () =>
	{
		const response = await request(path(ALIAS));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ alias: ALIAS, locked: false, retry_after: 0 });
	});

	it("reports a locked mailbox regardless of case", async () =>
	{
		await lock("Test123@Sato-Mail.xyz", "1234");

		const response = await request(path(ALIAS));

		expect(await response.json()).toEqual({ alias: ALIAS, locked: true, retry_after: 0 });
	});

	it.each(["nope", "a b@c.d", "@c.d", "a@"])("rejects the invalid alias %s", async (alias) =>
	{
		expect((await request(path(alias))).status).toBe(400);
	});
});

describe("PUT /mailboxes/:alias/lock", () =>
{
	beforeEach(resetData);

	it("locks a mailbox and never stores the pin in clear", async () =>
	{
		const response = await lock(ALIAS, "1234");
		const rows = await queryAll<{ alias: string; pin_hash: string; pin_salt: string }>("SELECT alias, pin_hash, pin_salt FROM mailbox_locks");

		expect(response.status).toBe(201);
		expect(rows).toHaveLength(1);
		expect(rows[0].alias).toBe(ALIAS);
		expect(rows[0].pin_hash).not.toContain("1234");
		expect(rows[0].pin_salt.length).toBeGreaterThanOrEqual(16);
	});

	it("uses a different salt and hash for each mailbox", async () =>
	{
		await lock("a@x.com", "1234");
		await lock("b@x.com", "1234");

		const rows = await queryAll<{ pin_hash: string; pin_salt: string }>("SELECT pin_hash, pin_salt FROM mailbox_locks");

		expect(rows[0].pin_salt).not.toBe(rows[1].pin_salt);
		expect(rows[0].pin_hash).not.toBe(rows[1].pin_hash);
	});

	it("refuses to lock a mailbox that is already locked", async () =>
	{
		await lock(ALIAS, "1234");

		expect((await lock(ALIAS, "9999")).status).toBe(409);
		expect((await unlock(ALIAS, "1234")).status).toBe(200);
	});

	it.each(["abc", "123", "123456789", "12 34", "", 1234, null])("rejects the invalid pin %j", async (pin) =>
	{
		const response = await requestJson(path(ALIAS, "/lock"), "PUT", { pin });

		expect(response.status).toBe(400);
		expect(await queryAll("SELECT alias FROM mailbox_locks")).toEqual([]);
	});

	it("rejects a body that is not json", async () =>
	{
		expect((await request(path(ALIAS, "/lock"), { method: "PUT", body: "{nope" })).status).toBe(400);
	});
});

describe("POST /mailboxes/:alias/unlock", () =>
{
	beforeEach(resetData);

	it("accepts the right pin and refuses a wrong one", async () =>
	{
		await lock(ALIAS, "1234");

		expect((await unlock(ALIAS, "1234")).status).toBe(200);
		expect((await unlock(ALIAS, "4321")).status).toBe(401);
	});

	it("returns 404 for a mailbox without a lock", async () =>
	{
		expect((await unlock(ALIAS, "1234")).status).toBe(404);
	});

	it("blocks the mailbox after five wrong pins, even for the right one", async () =>
	{
		await lock(ALIAS, "1234");

		for (let attempt = 1; attempt < 5; attempt++)
		{
			expect((await unlock(ALIAS, "0000")).status).toBe(401);
		}
		const fifth = await unlock(ALIAS, "0000");
		const body = await fifth.json() as { retry_after: number };

		expect(fifth.status).toBe(429);
		expect(body.retry_after).toBeGreaterThan(800);
		expect((await unlock(ALIAS, "1234")).status).toBe(429);

		const status = await (await request(path(ALIAS))).json() as { retry_after: number };
		expect(status.retry_after).toBeGreaterThan(0);
	});

	it("accepts the right pin again once the block has expired and resets the counter", async () =>
	{
		await lock(ALIAS, "1234");
		for (let attempt = 0; attempt < 5; attempt++)
		{
			await unlock(ALIAS, "0000");
		}

		await env.DB.prepare("UPDATE mailbox_locks SET blocked_until = 1 WHERE alias = ?").bind(ALIAS).run();

		expect((await unlock(ALIAS, "1234")).status).toBe(200);
		const rows = await queryAll<{ failed_attempts: number; blocked_until: number }>("SELECT failed_attempts, blocked_until FROM mailbox_locks");
		expect(rows[0]).toEqual({ failed_attempts: 0, blocked_until: 0 });
	});

	it("resets the failure counter after a success", async () =>
	{
		await lock(ALIAS, "1234");
		for (let attempt = 0; attempt < 4; attempt++)
		{
			await unlock(ALIAS, "0000");
		}
		await unlock(ALIAS, "1234");

		for (let attempt = 0; attempt < 4; attempt++)
		{
			expect((await unlock(ALIAS, "0000")).status).toBe(401);
		}
	});

	it.each([undefined, 1234, null, "abc"])("rejects the malformed pin %j", async (pin) =>
	{
		await lock(ALIAS, "1234");

		expect((await unlock(ALIAS, pin)).status).toBe(400);
	});
});

describe("DELETE /mailboxes/:alias/lock", () =>
{
	beforeEach(resetData);

	it("removes the lock with the right pin", async () =>
	{
		await lock(ALIAS, "1234");

		const response = await requestJson(path(ALIAS, "/lock"), "DELETE", { pin: "1234" });

		expect(response.status).toBe(204);
		expect(await queryAll("SELECT alias FROM mailbox_locks")).toEqual([]);
	});

	it("keeps the lock with a wrong pin and counts the failure", async () =>
	{
		await lock(ALIAS, "1234");

		const response = await requestJson(path(ALIAS, "/lock"), "DELETE", { pin: "0000" });
		const rows = await queryAll<{ failed_attempts: number }>("SELECT failed_attempts FROM mailbox_locks");

		expect(response.status).toBe(401);
		expect(rows[0].failed_attempts).toBe(1);
	});

	it("removes the lock without any pin as an administrative override", async () =>
	{
		await lock(ALIAS, "1234");

		const response = await request(path(ALIAS, "/lock"), { method: "DELETE" });

		expect(response.status).toBe(204);
		expect(await queryAll("SELECT alias FROM mailbox_locks")).toEqual([]);
	});

	it("returns 404 when there is no lock", async () =>
	{
		expect((await request(path(ALIAS, "/lock"), { method: "DELETE" })).status).toBe(404);
	});
});
