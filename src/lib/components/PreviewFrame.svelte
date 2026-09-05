<script module lang="ts">
	import { withTrailingSlash } from '$lib/utils';

	// The preview is proxied under previewUrl; the address bar speaks the path the app itself sees
	export function previewPath(href: string, previewUrl: string): string {
		const root = withTrailingSlash(previewUrl);
		return href.startsWith(root) ? `/${href.slice(root.length)}` : '/';
	}

	// A pasted absolute URL keeps only its path, and nothing may climb out of the prefix
	export function toPreviewUrl(previewUrl: string, typed: string): string {
		const root = withTrailingSlash(previewUrl);
		const trimmed = typed.trim();
		const absolute = URL.parse(trimmed);
		const relative = (absolute ? `${absolute.pathname}${absolute.search}` : trimmed).replace(
			/^\/+/,
			''
		);

		const resolved = URL.parse(relative, root);
		return resolved && resolved.href.startsWith(root) ? resolved.href : root;
	}
</script>

<script lang="ts">
	let { previewUrl, path = $bindable('/') }: { previewUrl: string | undefined; path?: string } =
		$props();

	let iframe: HTMLIFrameElement | undefined = $state();

	export function reload() {
		if (iframe && previewUrl) iframe.src = toPreviewUrl(previewUrl, path);
	}

	// Same origin through the proxy, so a link followed inside can be read back
	function showWhereItWent() {
		try {
			const href = iframe?.contentWindow?.location.href;
			if (href && previewUrl) path = previewPath(href, previewUrl);
		} catch {
			// navigated off-origin, so it is no longer ours to report
		}
	}
</script>

{#if previewUrl}
	<!-- Bordered so a preview that paints the same ground as this panel still reads as a page -->
	<iframe
		bind:this={iframe}
		title="Preview"
		src={previewUrl}
		onload={showWhereItWent}
		class="h-full w-full rounded-md border bg-background"
	></iframe>
{:else}
	<div class="flex h-full items-center justify-center text-muted-foreground">
		Waiting for server…
	</div>
{/if}
