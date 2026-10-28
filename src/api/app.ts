import { Hono } from "hono";
import type { AppEnv } from "../types";
import { attachmentRoutes } from "./attachments";
import { requireToken } from "./auth";
import { blocklistRoutes } from "./blocklist";
import { emailRoutes } from "./emails";
import { mailboxRoutes } from "./mailboxes";
import { totpRoutes } from "./totp";
import { usageRoutes } from "./usage";

export const app = new Hono<AppEnv>();

app.use("*", requireToken);
app.route("/emails", emailRoutes);
app.route("/attachments", attachmentRoutes);
app.route("/mailboxes", mailboxRoutes);
app.route("/mailboxes", totpRoutes);
app.route("/usage", usageRoutes);
app.route("/blocklist", blocklistRoutes);

app.notFound((c) =>
{
	return c.json({ errors: ["not found"] }, 404);
});

app.onError((error, c) =>
{
	console.error(error);
	return c.json({ errors: ["internal error"] }, 500);
});
