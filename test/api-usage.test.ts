import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/api/app";
import { request, resetData, seedAttachment, seedEmail } from "./helpers";

describe("GET /usage", () =>
{
	beforeEach(resetData);

	it("reports an empty storage against the 9 GB limit", async () =>
	{
		const response = await request("/usage");

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ used: 0, limit: 9_000_000_000 });
	});

	it("adds up the mails, the trash and the attachments of every mailbox", async () =>
	{
		const first = await seedEmail({ to_address: "a@sato-mail.xyz", size: 100 });
		await seedEmail({ to_address: "b@sato-mail.xyz", size: 250, is_deleted: 1 });
		await seedAttachment(first.id, { size: 40 });

		const response = await request("/usage");

		expect(await response.json()).toEqual({ used: 390, limit: 9_000_000_000 });
	});

	it("is not readable without the token", async () =>
	{
		const response = await app.request("/usage", {}, env);

		expect(response.status).toBe(401);
	});
});
