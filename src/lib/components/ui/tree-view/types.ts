import type { WithChildren, WithoutChildren } from 'bits-ui';
import type { Snippet } from 'svelte';
import type { ClassValue, HTMLAttributes, HTMLButtonAttributes } from 'svelte/elements';

export type TreeViewRootProps = HTMLAttributes<HTMLDivElement>;

export type TreeViewFolderProps = WithChildren<{
	name?: string;
	open?: boolean;
	// What cn() accepts, rather than the one shape of it callers happened to pass
	class?: ClassValue;
	icon?: Snippet<[{ name: string; open: boolean }]>;
	label?: Snippet;
}>;

export type TreeViewFilePropsWithoutHTML = WithChildren<{
	name: string;
	icon?: Snippet<[{ name: string }]>;
	label?: Snippet;
	editing?: boolean;
}>;

export type TreeViewFileProps = WithoutChildren<HTMLButtonAttributes> &
	TreeViewFilePropsWithoutHTML;
