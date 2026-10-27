import { openAliases, readAlias, route } from "@/lib/api";
import { getMailbox } from "@/lib/worker";

export default route({
	async GET(req, res)
	{
		const alias = readAlias(req, res);
		if (!alias)
		{
			return;
		}

		const mailbox = await getMailbox(alias);
		const unlocked = !mailbox.locked || openAliases(req).includes(alias);

		res.status(200).json({ alias, locked: mailbox.locked, unlocked, retry_after: mailbox.retry_after });
	},
});
