import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/api/app";
import { request } from "./helpers";

async function call(path: string, authorization?: string): Promise<Response>
{
	const headers: Record<string, string> = {};
	if (authorization !== undefined)
	{
		headers.Authorization = authorization;
	}
	return app.request(path, { headers }, env);
}

describe("auth", () =>
{
	it.each([
		["no header", undefined],
		["empty bearer", "Bearer "],
		["wrong token", "Bearer nope"],
		["longer wrong token", `Bearer ${"x".repeat(200)}`],
		["wrong scheme", "Basic test-token"],
		["token without scheme", "test-token"],
	])("rejects %s", async (_name, authorization) =>
	{
		const response = await call("/blocklist", authorization);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ errors: ["unauthorized"] });
	});

	it("accepts the right token", async () =>
	{
		const response = await call("/blocklist", "Bearer test-token");
		expect(response.status).toBe(200);
	});

	it("does not reveal unknown routes without a token", async () =>
	{
		expect((await call("/nothing")).status).toBe(401);
	});

	it("returns a json 404 for unknown routes with a token", async () =>
	{
		const response = await request("/nothing");

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ errors: ["not found"] });
	});
});
