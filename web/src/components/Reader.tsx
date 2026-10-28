import { useState } from "react";
import { formatFull, formatSize, sender } from "@/lib/client";
import type { MailDetail } from "@/lib/types";
import ConfirmButton from "./ConfirmButton";
import HtmlFrame from "./HtmlFrame";
import { BackIcon, ClipIcon, DotIcon, RestoreIcon, StarIcon, TrashIcon } from "./icons";

interface Props
{
	mail: MailDetail | null;
	loading: boolean;
	failed: boolean;
	onBack: () => void;
	onStar: () => void;
	onRead: () => void;
	onTrash: () => void;
	onDelete: () => void;
}

const action = "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-tint hover:text-ink";

function Body({ mail }: { mail: MailDetail })
{
	const hasText = mail.text_body.trim() !== "";
	const hasHtml = mail.html_body.trim() !== "";
	const [view, setView] = useState<"text" | "html">(!hasText && hasHtml ? "html" : "text");

	return (
		<>
			{hasText && hasHtml && (
				<div role="tablist" aria-label="Format du mail" className="mb-5 flex gap-5 border-b border-line">
					{(["text", "html"] as const).map((tab) => (
						<button
							key={tab}
							type="button"
							role="tab"
							aria-selected={view === tab}
							onClick={() => setView(tab)}
							className={`-mb-px border-b-2 pb-2 text-sm transition-colors ${view === tab ? "border-rose font-semibold text-ink" : "border-transparent text-muted hover:text-ink"}`}
						>
							{tab === "text" ? "Texte" : "HTML"}
						</button>
					))}
				</div>
			)}
			{view === "html" && hasHtml ? (
				<HtmlFrame html={mail.html_body} />
			) : hasText ? (
				<pre className="whitespace-pre-wrap break-words font-sans text-[0.95rem] leading-relaxed">{mail.text_body}</pre>
			) : (
				<p className="text-sm text-faint">Vide</p>
			)}
		</>
	);
}

export default function Reader({ mail, loading, failed, onBack, onStar, onRead, onTrash, onDelete }: Props)
{
	if (!mail)
	{
		return (
			<div className="flex h-full flex-col">
				<div className="px-3 py-3 lg:hidden">
					<button type="button" onClick={onBack} className={action}>
						<BackIcon /> Retour
					</button>
				</div>
				<p className="m-auto text-sm text-faint">{failed ? "Impossible d'ouvrir ce mail" : loading ? "Ouverture…" : ""}</p>
			</div>
		);
	}

	return (
		<article className="flex h-full flex-col">
			<div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2 md:px-6">
				<button type="button" onClick={onBack} className={`${action} mr-auto lg:hidden`}>
					<BackIcon /> Retour
				</button>
				<button type="button" onClick={onStar} aria-pressed={mail.is_starred} title="Étoile (S)" className={`${action} ${mail.is_starred ? "text-rose" : ""}`}>
					<StarIcon filled={mail.is_starred} /> Étoile
				</button>
				<button type="button" onClick={onRead} title="Lu / non lu (U)" className={action}>
					<DotIcon width={12} height={12} /> {mail.is_read ? "Non lu" : "Lu"}
				</button>
				<button type="button" onClick={onTrash} title="Corbeille (#)" className={`${action} hover:text-cherry`}>
					{mail.is_deleted ? <RestoreIcon /> : <TrashIcon />} {mail.is_deleted ? "Restaurer" : "Corbeille"}
				</button>
				{mail.is_deleted && (
					<ConfirmButton
						key={mail.id}
						label="Supprimer"
						confirmLabel="Confirmer ?"
						title="Supprimer définitivement"
						icon={<TrashIcon />}
						className={`${action} hover:text-cherry`}
						onConfirm={onDelete}
					/>
				)}
			</div>

			<div className="flex-1 overflow-y-auto px-5 py-7 md:px-10">
				<h1 className="break-words text-2xl font-semibold leading-snug tracking-tight md:text-3xl">{mail.subject || "(sans objet)"}</h1>

				<p className="mt-4 break-all text-sm">
					<span className="font-semibold">{sender(mail)}</span>
					{mail.from_name.trim() !== "" && <span className="text-muted"> {mail.from_address}</span>}
				</p>
				<p className="mt-0.5 text-sm text-faint">
					{formatFull(mail.received_at)} · {mail.to_address}
				</p>

				{mail.parse_failed && <p className="mt-5 text-sm text-cherry">Ce mail n&apos;a pas pu être lu correctement.</p>}

				{mail.attachments.length > 0 && (
					<ul aria-label="Pièces jointes" className="mt-5 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
						{mail.attachments.map((attachment) => (
							<li key={attachment.id}>
								<a
									href={`/api/emails/${mail.id}/attachments/${encodeURIComponent(attachment.id)}`}
									download
									className="inline-flex items-center gap-1.5 text-rose-deep hover:underline"
								>
									<ClipIcon width={14} height={14} />
									{attachment.filename}
									<span className="text-faint">{formatSize(attachment.size)}</span>
								</a>
							</li>
						))}
					</ul>
				)}

				<div className="mt-8">
					<Body key={mail.id} mail={mail} />
				</div>
			</div>
		</article>
	);
}
