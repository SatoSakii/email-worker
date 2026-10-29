import type { SVGProps } from "react";

function Icon({ children, ...props }: SVGProps<SVGSVGElement>)
{
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			{...props}
		>
			{children}
		</svg>
	);
}

export function StarIcon({ filled, ...props }: SVGProps<SVGSVGElement> & { filled?: boolean })
{
	return (
		<Icon {...props} fill={filled ? "currentColor" : "none"}>
			<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
		</Icon>
	);
}

export function TrashIcon(props: SVGProps<SVGSVGElement>)
{
	return (
		<Icon {...props}>
			<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
		</Icon>
	);
}

export function RestoreIcon(props: SVGProps<SVGSVGElement>)
{
	return (
		<Icon {...props}>
			<path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v5h5" />
		</Icon>
	);
}

export function LockIcon({ open, ...props }: SVGProps<SVGSVGElement> & { open?: boolean })
{
	return (
		<Icon {...props}>
			<rect x="5" y="11" width="14" height="9" rx="2" />
			<path d={open ? "M8 11V8a4 4 0 0 1 7.5-2" : "M8 11V8a4 4 0 0 1 8 0v3"} />
		</Icon>
	);
}

export function ClipIcon(props: SVGProps<SVGSVGElement>)
{
	return (
		<Icon {...props}>
			<path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7" />
		</Icon>
	);
}

export function BackIcon(props: SVGProps<SVGSVGElement>)
{
	return (
		<Icon {...props}>
			<path d="M15 5 8 12l7 7" />
		</Icon>
	);
}

export function ArrowIcon(props: SVGProps<SVGSVGElement>)
{
	return (
		<Icon {...props}>
			<path d="M5 12h14M13 6l6 6-6 6" />
		</Icon>
	);
}

export function RefreshIcon(props: SVGProps<SVGSVGElement>)
{
	return (
		<Icon {...props}>
			<path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" />
		</Icon>
	);
}

export function DotIcon(props: SVGProps<SVGSVGElement>)
{
	return (
		<Icon {...props} fill="currentColor" stroke="none">
			<circle cx="12" cy="12" r="5" />
		</Icon>
	);
}

export function CrossIcon(props: SVGProps<SVGSVGElement>)
{
	return (
		<Icon {...props}>
			<path d="M6 6l12 12M18 6 6 18" />
		</Icon>
	);
}
