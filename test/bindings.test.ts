import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("bindings", () =>
{
	it("exposes D1 and R2", async () =>
	{
		const row = await env.DB.prepare("SELECT 1 AS one").first<{ one: number }>();
		expect(row?.one).toBe(1);

		await env.BUCKET.put("probe", "ok");
		const object = await env.BUCKET.get("probe");
		expect(await object?.text()).toBe("ok");
	});
});
