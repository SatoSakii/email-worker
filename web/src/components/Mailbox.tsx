import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/client";
import type { FlagPatch, Folder, MailDetail, MailPage, MailSummary, MailboxStatus } from "@/lib/types";
import { LockIcon, RefreshIcon } from "./icons";
import LockGate from "./LockGate";
import LockMenu from "./LockMenu";
import MailList from "./MailList";
import Reader from "./Reader";

interface Props
{
	alias: string;
	prefix: string;
	domain: string;
}

type Gate = "checking" | "locked" | "open" | "error";

const POLL_MS = 30000;
const FOLDERS: { id: Folder; label: string }[] = [
	{ id: "inbox", label: "Reçus" },
	{ id: "starred", label: "Étoilés" },
	{ id: "trash", label: "Corbeille" },
];

function stays(mail: MailSummary, folder: Folder): boolean
{
	if (folder === "trash")
	{
		return mail.is_deleted;
	}
	if (folder === "starred")
	{
		return mail.is_starred && !mail.is_deleted;
	}
	return !mail.is_deleted;
}

export default function Mailbox({ alias, prefix, domain }: Props)
{
	const base = `/api/mailbox/${encodeURIComponent(prefix)}`;
	const [gate, setGate] = useState<Gate>("checking");
	const [protectedBox, setProtectedBox] = useState(false);
	const [retryAfter, setRetryAfter] = useState(0);
	const [folder, setFolder] = useState<Folder>("inbox");
	const [query, setQuery] = useState("");
	const [search, setSearch] = useState("");
	const [mails, setMails] = useState<MailSummary[]>([]);
	const [cursor, setCursor] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [reloadKey, setReloadKey] = useState(0);
	const [refreshing, setRefreshing] = useState(false);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [detail, setDetail] = useState<MailDetail | null>(null);
	const [detailLoading, setDetailLoading] = useState(false);
	const [detailFailed, setDetailFailed] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const [dialog, setDialog] = useState<"set" | "remove" | null>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const latest = useRef(0);
	const selectedRef = useRef<string | null>(null);
	const mailsRef = useRef<MailSummary[]>([]);

	useEffect(() =>
	{
		mailsRef.current = mails;
	}, [mails]);

	useEffect(() =>
	{
		let active = true;

		api<MailboxStatus>(base)
			.then((status) =>
			{
				if (!active)
				{
					return;
				}
				setProtectedBox(status.locked);
				setRetryAfter(status.retry_after);
				setGate(status.unlocked ? "open" : "locked");
			})
			.catch(() =>
			{
				if (active)
				{
					setGate("error");
				}
			});

		return () =>
		{
			active = false;
		};
	}, [base]);

	const clearSelection = useCallback(() =>
	{
		selectedRef.current = null;
		setSelectedId(null);
		setDetail(null);
		setDetailLoading(false);
		setDetailFailed(false);
	}, []);

	const handleError = useCallback((error: unknown) =>
	{
		if (error instanceof ApiError && error.status === 403)
		{
			setRetryAfter(error.body.retry_after ?? 0);
			setGate("locked");
			return;
		}
		setNotice("Le serveur ne répond pas. Réessaie dans un instant.");
	}, []);

	const fetchPage = useCallback((after: string | null) =>
	{
		const params = new URLSearchParams({ folder });
		if (search)
		{
			params.set("q", search);
		}
		if (after)
		{
			params.set("cursor", after);
		}
		return api<MailPage>(`${base}/emails?${params.toString()}`);
	}, [base, folder, search]);

	useEffect(() =>
	{
		if (gate !== "open")
		{
			return;
		}

		const id = ++latest.current;
		fetchPage(null)
			.then((page) =>
			{
				if (id === latest.current)
				{
					setMails(page.emails);
					setCursor(page.next_cursor);
				}
			})
			.catch((error) =>
			{
				if (id === latest.current)
				{
					handleError(error);
				}
			})
			.finally(() =>
			{
				if (id === latest.current)
				{
					setLoading(false);
					setRefreshing(false);
				}
			});
	}, [gate, fetchPage, handleError, reloadKey]);

	useEffect(() =>
	{
		const trimmed = query.trim();
		if (trimmed === search)
		{
			return;
		}

		const timer = window.setTimeout(() =>
		{
			setSearch(trimmed);
			setMails([]);
			setCursor(null);
			setLoading(true);
			clearSelection();
		}, 300);

		return () => window.clearTimeout(timer);
	}, [query, search, clearSelection]);

	const refresh = useCallback(async () =>
	{
		const id = latest.current;

		try
		{
			const page = await fetchPage(null);
			if (id !== latest.current)
			{
				return;
			}

			const current = mailsRef.current;
			if (page.next_cursor === null || current.length <= page.emails.length)
			{
				setMails(page.emails);
				setCursor(page.next_cursor);
				return;
			}

			const boundary = page.emails[page.emails.length - 1].received_at;
			const known = new Set(page.emails.map((mail) => mail.id));
			setMails([...page.emails, ...current.filter((mail) => !known.has(mail.id) && mail.received_at < boundary)]);
		}
		catch (error)
		{
			if (error instanceof ApiError && error.status === 403)
			{
				handleError(error);
			}
		}
	}, [fetchPage, handleError]);

	useEffect(() =>
	{
		if (gate !== "open")
		{
			return;
		}

		const timer = window.setInterval(() =>
		{
			if (document.visibilityState === "visible")
			{
				void refresh();
			}
		}, POLL_MS);

		return () => window.clearInterval(timer);
	}, [gate, refresh]);

	useEffect(() =>
	{
		if (!notice)
		{
			return;
		}

		const timer = window.setTimeout(() => setNotice(null), 4000);
		return () => window.clearTimeout(timer);
	}, [notice]);

	const patch = useCallback(async (id: string, change: FlagPatch) =>
	{
		const target = mailsRef.current.find((mail) => mail.id === id);
		const removed = target ? !stays({ ...target, ...change }, folder) : false;

		setMails((current) => current.flatMap((mail) =>
		{
			if (mail.id !== id)
			{
				return [mail];
			}
			const next = { ...mail, ...change };
			return stays(next, folder) ? [next] : [];
		}));
		setDetail((current) => (current && current.id === id ? { ...current, ...change } : current));
		if (removed && selectedRef.current === id)
		{
			clearSelection();
		}

		try
		{
			await api(`/api/emails/${id}`, { method: "PATCH", body: JSON.stringify(change) });
		}
		catch (error)
		{
			if (error instanceof ApiError && error.status === 403)
			{
				handleError(error);
				return;
			}
			setNotice("Action impossible. La liste a été rechargée.");
			setReloadKey((key) => key + 1);
		}
	}, [folder, clearSelection, handleError]);

	const openMail = useCallback(async (id: string) =>
	{
		selectedRef.current = id;
		setSelectedId(id);
		setDetail(null);
		setDetailFailed(false);
		setDetailLoading(true);

		try
		{
			const mail = await api<MailDetail>(`/api/emails/${id}`);
			if (selectedRef.current !== id)
			{
				return;
			}
			setDetail(mail);
			if (!mail.is_read)
			{
				void patch(id, { is_read: true });
			}
		}
		catch (error)
		{
			if (selectedRef.current === id)
			{
				setDetailFailed(true);
				handleError(error);
			}
		}
		finally
		{
			if (selectedRef.current === id)
			{
				setDetailLoading(false);
			}
		}
	}, [handleError, patch]);

	const reload = useCallback(() =>
	{
		setRefreshing(true);
		setReloadKey((current) => current + 1);
	}, []);

	useEffect(() =>
	{
		function onKey(event: KeyboardEvent)
		{
			if (event.metaKey || event.ctrlKey || event.altKey || dialog)
			{
				return;
			}

			const target = event.target as HTMLElement;
			if (target.closest("input, textarea, select, [contenteditable]"))
			{
				if (event.key === "Escape" && target === searchRef.current)
				{
					setQuery("");
					target.blur();
				}
				return;
			}

			const index = mails.findIndex((mail) => mail.id === selectedId);
			const key = event.key.toLowerCase();

			if (key === "j" || key === "arrowdown")
			{
				event.preventDefault();
				const next = mails[index + 1];
				if (next)
				{
					void openMail(next.id);
				}
			}
			else if (key === "k" || key === "arrowup")
			{
				event.preventDefault();
				const previous = index > 0 ? mails[index - 1] : undefined;
				if (previous)
				{
					void openMail(previous.id);
				}
			}
			else if (key === "s" && detail)
			{
				void patch(detail.id, { is_starred: !detail.is_starred });
			}
			else if (key === "u" && detail)
			{
				void patch(detail.id, { is_read: !detail.is_read });
			}
			else if ((key === "#" || key === "d") && detail)
			{
				void patch(detail.id, { is_deleted: !detail.is_deleted });
			}
			else if (key === "/")
			{
				event.preventDefault();
				searchRef.current?.focus();
			}
			else if (key === "r")
			{
				reload();
			}
			else if (key === "escape")
			{
				clearSelection();
			}
		}

		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [mails, selectedId, detail, dialog, openMail, patch, clearSelection, reload]);

	function changeFolder(next: Folder)
	{
		if (next === folder)
		{
			return;
		}
		setFolder(next);
		setMails([]);
		setCursor(null);
		setLoading(true);
		clearSelection();
	}

	function loadMore()
	{
		if (!cursor || loading)
		{
			return;
		}

		const id = latest.current;
		setLoading(true);
		fetchPage(cursor)
			.then((page) =>
			{
				if (id !== latest.current)
				{
					return;
				}
				setMails((current) => [...current, ...page.emails.filter((mail) => !current.some((known) => known.id === mail.id))]);
				setCursor(page.next_cursor);
			})
			.catch(handleError)
			.finally(() => setLoading(false));
	}

	async function closeBox()
	{
		await api(`${base}/unlock`, { method: "DELETE" }).catch(() => undefined);
		setMails([]);
		setCursor(null);
		setLoading(true);
		clearSelection();
		setRetryAfter(0);
		setGate("locked");
	}

	if (gate === "checking")
	{
		return (
			<main className="grid min-h-dvh place-items-center text-sm text-faint" role="status">
				Ouverture…
			</main>
		);
	}

	if (gate === "error")
	{
		return (
			<main className="grid min-h-dvh place-items-center px-6">
				<div className="text-center">
					<p className="text-lg font-semibold">Boîte injoignable</p>
					<Link href="/" className="mt-3 inline-block text-sm text-rose-deep hover:underline">
						Accueil
					</Link>
				</div>
			</main>
		);
	}

	if (gate === "locked")
	{
		return <LockGate alias={alias} prefix={prefix} retryAfter={retryAfter} onUnlocked={() => setGate("open")} />;
	}

	const showReader = selectedId !== null;
	const link = "text-sm text-muted transition-colors hover:text-ink";

	return (
		<div className="flex h-dvh flex-col lg:grid lg:grid-cols-[14rem_23rem_1fr]">
			<aside className={`${showReader ? "hidden lg:flex" : "flex"} shrink-0 flex-col gap-4 border-b border-line bg-tint px-4 py-4 lg:gap-6 lg:border-b-0 lg:border-r lg:px-5 lg:py-6`}>
				<Link href="/" className={link}>
					← {domain}
				</Link>

				<div>
					<h1 className="flex items-center gap-2 break-all text-xl font-semibold tracking-tight">
						{prefix}
						{protectedBox && <LockIcon width={14} height={14} className="shrink-0 text-rose-deep" />}
					</h1>
					<p className="break-all text-sm text-muted">@{domain}</p>
				</div>

				<nav aria-label="Dossiers" className="flex gap-1 lg:flex-col">
					{FOLDERS.map((item) => (
						<button
							key={item.id}
							type="button"
							onClick={() => changeFolder(item.id)}
							aria-current={folder === item.id ? "page" : undefined}
							className={`rounded-md px-3 py-1.5 text-left text-sm transition-colors ${folder === item.id ? `bg-white font-semibold ${item.id === "trash" ? "text-cherry" : "text-rose-deep"}` : "text-muted hover:text-ink"}`}
						>
							{item.label}
						</button>
					))}
				</nav>

				<div className="flex gap-4 lg:mt-auto lg:flex-col lg:items-start lg:gap-1.5">
					{protectedBox ? (
						<>
							<button type="button" onClick={() => void closeBox()} className={link}>
								Fermer
							</button>
							<button type="button" onClick={() => setDialog("remove")} className={link}>
								Retirer le PIN
							</button>
						</>
					) : (
						<button type="button" onClick={() => setDialog("set")} className={link}>
							Poser un PIN
						</button>
					)}
				</div>
			</aside>

			<section aria-label="Liste des mails" className={`${showReader ? "hidden lg:flex" : "flex"} min-h-0 flex-1 flex-col lg:flex-none lg:border-r lg:border-line`}>
				<label htmlFor="search" className="sr-only">
					Rechercher
				</label>
				<div className="flex items-center border-b border-line transition-colors focus-within:border-rose">
					<input
						id="search"
						ref={searchRef}
						type="search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Rechercher"
						autoComplete="off"
						className="min-w-0 flex-1 bg-transparent py-3.5 pl-5 pr-2 text-sm outline-none placeholder:text-faint"
					/>
					<button
						type="button"
						onClick={reload}
						disabled={refreshing}
						aria-label="Actualiser les mails"
						title="Actualiser (R)"
						className="mr-2 grid size-9 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-tint hover:text-rose-deep disabled:hover:bg-transparent"
					>
						<RefreshIcon className={refreshing ? "animate-spin motion-reduce:animate-none" : ""} />
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto">
					<MailList
						mails={mails}
						selectedId={selectedId}
						loading={loading}
						hasMore={cursor !== null}
						folder={folder}
						search={search}
						alias={alias}
						onSelect={(id) => void openMail(id)}
						onMore={loadMore}
					/>
				</div>
			</section>

			<section aria-label="Lecteur" className={`${showReader ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-1 flex-col`}>
				<Reader
					mail={detail}
					loading={detailLoading}
					failed={detailFailed}
					onBack={clearSelection}
					onStar={() => detail && void patch(detail.id, { is_starred: !detail.is_starred })}
					onRead={() => detail && void patch(detail.id, { is_read: !detail.is_read })}
					onTrash={() => detail && void patch(detail.id, { is_deleted: !detail.is_deleted })}
				/>
			</section>

			{dialog && (
				<LockMenu
					mode={dialog}
					prefix={prefix}
					onClose={() => setDialog(null)}
					onDone={(mode) =>
					{
						setProtectedBox(mode === "set");
						setDialog(null);
					}}
				/>
			)}

			{notice && (
				<p role="status" aria-live="polite" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-md bg-ink px-4 py-2.5 text-sm text-white">
					{notice}
				</p>
			)}
		</div>
	);
}
