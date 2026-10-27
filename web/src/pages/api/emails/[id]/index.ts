import { loadMail, route } from "@/lib/api";
import type { FlagPatch } from "@/lib/types";
import { patchMail } from "@/lib/worker";

const FLAGS = ["is_read", "is_starred", "is_deleted"] as const;

function readPatch(body: unknown): FlagPatch | null
{
	if (typeof body !== "object" || body === null || Array.isArray(body))
	{
		return null;
	}

	const patch: FlagPatch = {};
	for (const flag of FLAGS)
	{
		const value = (body as Record<string, unknown>)[flag];
		if (value === undefined)
		{
			continue;
		}
		if (typeof value !== "boolean")
		{
			return null;
		}
		patch[flag] = value;
	}

	return Object.keys(patch).length > 0 ? patch : null;
}

export default route({
	async GET(req, res)
	{
		const mail = await loadMail(req, res);
		if (mail)
		{
			res.status(200).json(mail);
		}
	},
	async PATCH(req, res)
	{
		const patch = readPatch(req.body);
		if (!patch)
		{
			res.status(400).json({ errors: ["send is_read, is_starred or is_deleted as booleans"] });
			return;
		}

		const mail = await loadMail(req, res);
		if (!mail)
		{
			return;
		}

		res.status(200).json(await patchMail(mail.id, patch));
	},
});
