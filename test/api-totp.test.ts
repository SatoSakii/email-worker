import { beforeEach, describe, expect, it } from "vitest";
import { queryAll, request, requestJson, resetData } from "./helpers";

const ALIAS = "shop@sato-mail.xyz";
const SECRET = "GEZDGNBVGY3TQOJQ";

function path(alias = ALIAS, suffix = ""): string
{
	return `/mailboxes/${encodeURIComponent(alias)}/totp${suffix}`;
}

function add(body: unknown, alias = ALIAS): Promise<Response>
{
	return requestJson(path(alias), "POST", body);
}

describe("totp keys", () =>
{
	beforeEach(resetData);

	it("starts empty", async () =>
	{
		const response = await request(path());

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ keys: [] });
	});

	it("stores a key with the defaults and lists it", async () =>
	{
		const created = await add({ name: "GitHub", secret: SECRET });

		expect(created.status).toBe(201);
		const key = await created.json() as { id: string };
		expect(key).toEqual({ id: expect.any(String), name: "GitHub", secret: SECRET, digits: 6, period: 30, algorithm: "SHA-1" });
		expect(await (await request(path())).json()).toEqual({ keys: [key] });
	});

	it("normalizes the secret and the name", async () =>
	{
		const response = await add({ name: "  Perso  ", secret: "gezd gnbv-gy3t qojq====", digits: 8, period: 60, algorithm: "SHA-256" });

		expect(await response.json()).toMatchObject({ name: "Perso", secret: SECRET, digits: 8, period: 60, algorithm: "SHA-256" });
	});

	it("keeps the keys of each alias apart and normalizes the alias", async () =>
	{
		await add({ name: "One", secret: SECRET });
		await add({ name: "Two", secret: SECRET }, "other@sato-mail.xyz");

		expect(await (await request(path("SHOP@sato-mail.xyz"))).json()).toMatchObject({ keys: [{ name: "One" }] });
		expect(await (await request(path("other@sato-mail.xyz"))).json()).toMatchObject({ keys: [{ name: "Two" }] });
	});

	it("lists the keys in the order they were added", async () =>
	{
		await add({ name: "First", secret: SECRET });
		await add({ name: "Second", secret: SECRET });

		const body = await (await request(path())).json() as { keys: { name: string }[] };
		expect(body.keys.map((key) => key.name)).toEqual(["First", "Second"]);
	});

	it.each([
		["a missing name", { secret: SECRET }],
		["a blank name", { name: "   ", secret: SECRET }],
		["a too long name", { name: "x".repeat(61), secret: SECRET }],
		["a missing secret", { name: "A" }],
		["a secret that is not base32", { name: "A", secret: "abc1abc1abc1" }],
		["a too short secret", { name: "A", secret: "ABC" }],
		["digits out of range", { name: "A", secret: SECRET, digits: 9 }],
		["digits that are not a number", { name: "A", secret: SECRET, digits: "6" }],
		["a period out of range", { name: "A", secret: SECRET, period: 0 }],
		["an unknown algorithm", { name: "A", secret: SECRET, algorithm: "MD5" }],
	])("rejects %s", async (_label, body) =>
	{
		const response = await add(body);

		expect(response.status).toBe(400);
		expect(await queryAll("SELECT id FROM totp_keys")).toEqual([]);
	});

	it("rejects a body that is not a json object", async () =>
	{
		const response = await request(path(), { method: "POST", body: "nope" });

		expect(response.status).toBe(400);
	});

	it("rejects an invalid alias", async () =>
	{
		expect((await request(path("nope"))).status).toBe(400);
		expect((await add({ name: "A", secret: SECRET }, "nope")).status).toBe(400);
		expect((await request(path("nope", "/x"), { method: "DELETE" })).status).toBe(400);
	});

	it("refuses more than 50 keys per alias", async () =>
	{
		for (let index = 0; index < 50; index++)
		{
			expect((await add({ name: `Key ${index}`, secret: SECRET })).status).toBe(201);
		}

		expect((await add({ name: "One more", secret: SECRET })).status).toBe(409);
		expect((await add({ name: "Elsewhere", secret: SECRET }, "other@sato-mail.xyz")).status).toBe(201);
	});

	it("deletes a key of the alias only", async () =>
	{
		const key = await (await add({ name: "A", secret: SECRET })).json() as { id: string };
		const other = await (await add({ name: "B", secret: SECRET }, "other@sato-mail.xyz")).json() as { id: string };

		expect((await request(path(ALIAS, `/${other.id}`), { method: "DELETE" })).status).toBe(404);
		expect((await request(path(ALIAS, `/${key.id}`), { method: "DELETE" })).status).toBe(204);
		expect((await request(path(ALIAS, `/${key.id}`), { method: "DELETE" })).status).toBe(404);
		expect(await queryAll("SELECT id FROM totp_keys")).toEqual([{ id: other.id }]);
	});

	it("requires the api token", async () =>
	{
		const { app } = await import("../src/api/app");
		const { env } = await import("cloudflare:workers");

		expect((await app.request(path(), {}, env)).status).toBe(401);
		expect((await app.request(path(), { method: "POST", body: "{}" }, env)).status).toBe(401);
	});
});
