import { openAliases, readAlias, readPin, route, saveAliases } from "@/lib/api";
import { unlockMailbox } from "@/lib/worker";

export default route({
	async POST(req, res)
	{
		const alias = readAlias(req, res);
		if (!alias)
		{
			return;
		}

		const pin = readPin(req);
		if (!pin)
		{
			res.status(400).json({ errors: ["pin must be 4 to 8 digits"] });
			return;
		}

		await unlockMailbox(alias, pin);
		saveAliases(res, [...openAliases(req).filter((open) => open !== alias), alias]);
		res.status(200).json({ ok: true });
	},
	async DELETE(req, res)
	{
		const alias = readAlias(req, res);
		if (!alias)
		{
			return;
		}

		saveAliases(res, openAliases(req).filter((open) => open !== alias));
		res.status(204).end();
	},
});
