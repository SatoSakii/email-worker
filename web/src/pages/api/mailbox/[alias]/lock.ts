import { openAliases, readAlias, readPin, route, saveAliases } from "@/lib/api";
import { lockMailbox, removeLock } from "@/lib/worker";

export default route({
	async PUT(req, res)
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

		await lockMailbox(alias, pin);
		saveAliases(res, [...openAliases(req).filter((open) => open !== alias), alias]);
		res.status(201).json({ alias, locked: true });
	},
	async DELETE(req, res)
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

		await removeLock(alias, pin);
		saveAliases(res, openAliases(req).filter((open) => open !== alias));
		res.status(204).end();
	},
});
