import { useEffect, useState } from "react";
import type { ReactNode } from "react";

interface Props
{
	label: string;
	confirmLabel: string;
	title?: string;
	disabled?: boolean;
	icon?: ReactNode;
	className: string;
	onConfirm: () => void;
}

export default function ConfirmButton({ label, confirmLabel, title, disabled, icon, className, onConfirm }: Props)
{
	const [armed, setArmed] = useState(false);

	useEffect(() =>
	{
		if (!armed)
		{
			return;
		}

		const timer = window.setTimeout(() => setArmed(false), 4000);
		return () => window.clearTimeout(timer);
	}, [armed]);

	return (
		<button
			type="button"
			title={title}
			disabled={disabled}
			onClick={() =>
			{
				if (armed)
				{
					setArmed(false);
					onConfirm();
					return;
				}
				setArmed(true);
			}}
			onBlur={() => setArmed(false)}
			className={`${className} ${armed ? "!bg-cherry !text-white" : ""} disabled:opacity-50`}
		>
			{icon}
			{armed ? confirmLabel : label}
		</button>
	);
}
