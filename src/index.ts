import { app } from "./api/app";
import { handleEmail } from "./email/handler";
import type { Env } from "./types";

export default {
	fetch: app.fetch,
	async email(message, env)
	{
		await handleEmail(message, env);
	},
} satisfies ExportedHandler<Env>;
