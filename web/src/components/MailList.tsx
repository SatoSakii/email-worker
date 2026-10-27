import { formatWhen, sender } from "@/lib/client";
import type { Folder, MailSummary } from "@/lib/types";
import { ClipIcon, StarIcon } from "./icons";

interface Props
{
	mails: MailSummary[];
	selectedId: string | null;
	loading: boolean;
	hasMore: boolean;
	folder: Folder;
	search: string;
	alias: string;
	onSelect: (id: string) => void;
	onMore: () => void;
}

function emptyText(folder: Folder, search: string): string
{
	if (search)
	{
		return "Aucun résultat";
	}
	if (folder === "starred")
	{
		return "Aucun mail étoilé";
	}
	if (folder === "trash")
	{
		return "Corbeille vide";
	}
	return "Aucun mail";
}

export default function MailList({ mails, selectedId, loading, hasMore, folder, search, alias, onSelect, onMore }: Props)
{
	if (loading && mails.length === 0)
	{
		return (
			<p role="status" className="px-5 py-6 text-sm text-faint">
				Chargement…
			</p>
		);
	}

	if (mails.length === 0)
	{
		return (
			<div className="px-5 py-6">
				<p className="text-sm text-muted">{emptyText(folder, search)}</p>
				{folder === "inbox" && !search && <p className="mt-1 break-all text-sm text-faint">{alias}</p>}
			</div>
		);
	}

	return (
		<ul role="listbox" aria-label="Mails">
			{mails.map((mail) =>
			{
				const selected = mail.id === selectedId;
				return (
					<li key={mail.id} role="option" aria-selected={selected} className="border-b border-line/60">
						<button
							type="button"
							onClick={() => onSelect(mail.id)}
							className={`block w-full px-5 py-3 text-left transition-colors ${selected ? "bg-tint" : "hover:bg-tint/50"}`}
						>
							<span className="flex items-baseline gap-2">
								{!mail.is_read && <span aria-label="Non lu" className="size-1.5 shrink-0 translate-y-[-0.1em] rounded-full bg-rose" />}
								<span className={`min-w-0 flex-1 truncate text-sm ${mail.is_read ? "text-muted" : "font-semibold"}`}>{sender(mail)}</span>
								<span className="flex shrink-0 items-center gap-1.5 text-xs text-faint">
									{mail.has_attachments && <ClipIcon width={12} height={12} />}
									{mail.is_starred && <StarIcon filled width={12} height={12} className="text-rose" />}
									{formatWhen(mail.received_at)}
								</span>
							</span>
							<span className={`mt-0.5 block truncate text-sm ${mail.is_read ? "text-faint" : "text-ink"}`}>{mail.subject || "(sans objet)"}</span>
						</button>
					</li>
				);
			})}
			{hasMore && (
				<li>
					<button type="button" onClick={onMore} disabled={loading} className="w-full px-5 py-3 text-left text-sm text-muted transition-colors hover:text-rose-deep disabled:opacity-50">
						{loading ? "Chargement…" : "Voir plus"}
					</button>
				</li>
			)}
		</ul>
	);
}
