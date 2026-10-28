import { readAlias, requireAccess, route } from "@/lib/api";
import { addTotp, listTotp } from "@/lib/worker";

export default route({
	async GET(req, res)
	{
		const alias = readAlias(req, res);
		if (!alias)
		{
			return;
		}

		if (!await requireAccess(req, res, alias))
		{
			return;
		}

		res.status(200).json(await listTotp(alias));
	},
	async POST(req, res)
	{
		const alias = readAlias(req, res);
		if (!alias)
		{
			return;
		}

		const body = req.body as Record<string, unknown> | null | undefined;
		if (typeof body !== "object" || body === null || Array.isArray(body))
		{
			res.status(400).json({ errors: ["invalid json body"] });
			return;
		}

		if (!await requireAccess(req, res, alias))
		{
			return;
		}

		const { name, secret, digits, period, algorithm } = body as never;
		res.status(201).json(await addTotp(alias, { name, secret, digits, period, algorithm }));
	},
});
