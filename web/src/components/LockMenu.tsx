import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, pinMessage } from "@/lib/client";

interface Props
{
	mode: "set" | "remove";
	prefix: string;
	onClose: () => void;
	onDone: (mode: "set" | "remove") => void;
}

export default function LockMenu({ mode, prefix, onClose, onDone }: Props)
{
	const [pin, setPin] = useState("");
	const [confirm, setConfirm] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const setting = mode === "set";

	useEffect(() =>
	{
		function onKey(event: KeyboardEvent)
		{
			if (event.key === "Escape")
			{
				onClose();
			}
		}

		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	async function submit(event: FormEvent)
	{
		event.preventDefault();

		if (setting && pin !== confirm)
		{
			setError("Les deux PIN sont différents.");
			return;
		}

		setBusy(true);
		setError(null);

		try
		{
			await api(`/api/mailbox/${encodeURIComponent(prefix)}/lock`, { method: setting ? "PUT" : "DELETE", body: JSON.stringify({ pin }) });
			onDone(mode);
		}
		catch (caught)
		{
			setError(pinMessage(caught));
			setBusy(false);
		}
	}

	const field = "mt-3 w-full border-b border-line bg-transparent py-2.5 text-center text-xl tracking-[0.4em] outline-none transition-colors placeholder:text-faint placeholder:tracking-normal focus:border-rose";

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-ink/25 px-6" onMouseDown={onClose}>
			<form
				role="dialog"
				aria-modal="true"
				aria-labelledby="lock-title"
				onSubmit={submit}
				onMouseDown={(event) => event.stopPropagation()}
				className="w-full max-w-sm rounded-lg border border-line bg-paper p-6"
			>
				<h2 id="lock-title" className="text-lg font-semibold tracking-tight">
					{setting ? "Poser un PIN" : "Retirer le PIN"}
				</h2>
				<p className="mt-1 text-sm text-muted">{setting ? "4 à 8 chiffres. Il ne se récupère pas." : "Entre le PIN actuel."}</p>

				<label htmlFor="lock-pin" className="sr-only">
					PIN
				</label>
				<input
					id="lock-pin"
					type="password"
					inputMode="numeric"
					autoComplete="off"
					autoFocus
					maxLength={8}
					value={pin}
					onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
					placeholder="PIN"
					className={field}
				/>

				{setting && (
					<>
						<label htmlFor="lock-confirm" className="sr-only">
							Confirmer le PIN
						</label>
						<input
							id="lock-confirm"
							type="password"
							inputMode="numeric"
							autoComplete="off"
							maxLength={8}
							value={confirm}
							onChange={(event) => setConfirm(event.target.value.replace(/\D/g, ""))}
							placeholder="Confirmer"
							className={field}
						/>
					</>
				)}

				<p role="alert" className="mt-2 min-h-6 text-sm text-cherry">
					{error}
				</p>

				<div className="mt-3 flex justify-end gap-2">
					<button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm text-muted transition-colors hover:bg-tint hover:text-ink">
						Annuler
					</button>
					<button
						type="submit"
						disabled={busy || pin.length < 4 || (setting && confirm.length < 4)}
						className={`rounded-md px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-40 ${setting ? "bg-rose hover:bg-rose-deep" : "bg-cherry hover:brightness-90"}`}
					>
						{setting ? "Verrouiller" : "Retirer"}
					</button>
				</div>
			</form>
		</div>
	);
}
