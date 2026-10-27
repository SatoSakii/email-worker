import { Hono } from "hono";
import { getAttachment } from "../db/emails";
import type { AppEnv } from "../types";

function encodeFilename(filename: string): string
{
	return encodeURIComponent(filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export const attachmentRoutes = new Hono<AppEnv>();

attachmentRoutes.get("/:id", async (c) =>
{
	const attachment = await getAttachment(c.env.DB, c.req.param("id"));
	const object = attachment ? await c.env.BUCKET.get(attachment.r2_key) : null;
	if (!attachment || !object)
	{
		return c.json({ errors: ["not found"] }, 404);
	}

	return new Response(object.body, {
		headers: {
			"Content-Type": attachment.content_type,
			"Content-Disposition": `attachment; filename*=UTF-8''${encodeFilename(attachment.filename)}`,
			"Content-Length": String(object.size),
			"X-Content-Type-Options": "nosniff",
		},
	});
});
