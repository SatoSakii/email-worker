import { first, loadMail, route } from "@/lib/api";
import { fetchAttachment } from "@/lib/worker";

export default route({
	async GET(req, res)
	{
		const mail = await loadMail(req, res);
		if (!mail)
		{
			return;
		}

		const attachment = mail.attachments.find((item) => item.id === first(req.query.aid));
		if (!attachment)
		{
			res.status(404).json({ errors: ["not found"] });
			return;
		}

		const upstream = await fetchAttachment(attachment.id);

		res.setHeader("Content-Type", upstream.headers.get("Content-Type") ?? "application/octet-stream");
		res.setHeader("Content-Disposition", upstream.headers.get("Content-Disposition") ?? "attachment");
		res.setHeader("X-Content-Type-Options", "nosniff");
		res.setHeader("Content-Security-Policy", "sandbox");
		res.status(200).send(Buffer.from(await upstream.arrayBuffer()));
	},
});
