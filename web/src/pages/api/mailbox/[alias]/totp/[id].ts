import { readAlias, readId, requireAccess, route } from "@/lib/api";
import { removeTotp } from "@/lib/worker";

export default route({
	async DELETE(req, res)
	{
		const alias = readAlias(req, res);
		if (!alias)
		{
			return;
		}

		const id = readId(req, res);
		if (!id)
		{
			return;
		}

		if (!await requireAccess(req, res, alias))
		{
			return;
		}

		await removeTotp(alias, id);
		res.status(204).end();
	},
});
