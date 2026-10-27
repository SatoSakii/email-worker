import { first, readAlias, requireAccess, route } from "@/lib/api";
import type { Folder } from "@/lib/types";
import { listMail } from "@/lib/worker";

const FOLDERS: Folder[] = ["inbox", "starred", "trash"];
const LIMIT = 30;
const MAX_TEXT = 200;

export default route({
	async GET(req, res)
	{
		const alias = readAlias(req, res);
		if (!alias)
		{
			return;
		}

		const folder = (first(req.query.folder) ?? "inbox") as Folder;
		if (!FOLDERS.includes(folder))
		{
			res.status(400).json({ errors: ["unknown folder"] });
			return;
		}

		if (!await requireAccess(req, res, alias))
		{
			return;
		}

		const q = first(req.query.q)?.slice(0, MAX_TEXT);
		const cursor = first(req.query.cursor)?.slice(0, MAX_TEXT);

		res.status(200).json(await listMail(alias, { folder, q, cursor, limit: LIMIT }));
	},
});
