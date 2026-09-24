<script lang="ts">
	import type { LucideProps } from '@lucide/svelte';

	const {
		class: className,
		color = 'currentColor',
		size = 24,
		strokeWidth = 2,
		absoluteStrokeWidth = false,
		...rest
	}: LucideProps = $props();

	const stroke = $derived(
		absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth
	);
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke={color}
	stroke-width={stroke}
	stroke-linecap="round"
	stroke-linejoin="round"
	class={['lucide-icon', 'lucide', className]}
	{...rest}
>
	<path d="M4.12 5.84A10 10 0 1 1 4.12 18.16" />
	<path d="M12 2a14.5 14.5 0 0 1 0 20" />
	<path d="M2 12h20" />
	<path d="m8 8 4 4-4 4" />
</svg>
