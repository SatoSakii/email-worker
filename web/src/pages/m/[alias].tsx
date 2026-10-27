import type { GetServerSideProps } from "next";
import Head from "next/head";
import Mailbox from "@/components/Mailbox";
import { toAlias, toPrefix } from "@/lib/alias";
import { readConfig } from "@/lib/config";

interface Props
{
	alias: string;
	prefix: string;
	domain: string;
}

export const getServerSideProps: GetServerSideProps<Props> = async ({ params }) =>
{
	const { mailDomain } = readConfig();
	const alias = toAlias(String(params?.alias ?? ""), mailDomain);
	if (!alias)
	{
		return { notFound: true };
	}

	return { props: { alias, prefix: toPrefix(alias), domain: mailDomain } };
};

export default function MailboxPage(props: Props)
{
	return (
		<>
			<Head>
				<title>{`${props.prefix} · ${props.domain}`}</title>
			</Head>
			<Mailbox {...props} />
		</>
	);
}
