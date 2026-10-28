import { readAlias, requireAccess, route } from "@/lib/api";
import { emptyTrash } from "@/lib/worker";

const MAX_ROUNDS = 10;

export default route({
	async DELETE(req, res)
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

		let deleted = 0;
		let remaining = true;
		for (let round = 0; round < MAX_ROUNDS && remaining; round++)
		{
			const result = await emptyTrash(alias);
			deleted += result.deleted;
			remaining = result.remaining;
		}

		res.status(200).json({ deleted, remaining });
	},
});
