<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { Button } from '$lib/components/ui/button';
	import * as ButtonGroup from '$lib/components/ui/button-group';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as UnderlineTabs from '$lib/components/ui/underline-tabs';
	import { getGraphState, nodeName } from '$lib/graph-state.svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { getResourceDefinition } from '$lib/resources';
	import { shellLaunchOptions } from '$lib/shell-launch';
	import { shellSessions, type ShellOwner } from '$lib/shell-sessions.svelte';

	const { owner, onOpen }: { owner: ShellOwner; onOpen?: () => void } = $props();

	const graphState = getGraphState();
	const orchestrator = getOrchestrator();

	// Same gate as the Edit Resource Code button: a shell is only useful where a user owns files
	const shellNodes = $derived(
		graphState.nodes.filter((node) => getResourceDefinition(node.type).hasEditableFiles)
	);
	const names = $derived(new Map(graphState.nodes.map((node) => [node.id, nodeName(node)])));

	const nameOf = (target: ShellOwner) =>
		target.kind === 'admin' ? 'Admin' : (names.get(target.nodeId) ?? 'Shell');
	const ownerName = $derived(nameOf(owner));

	function open(target: ShellOwner) {
		shellSessions.open(target, shellLaunchOptions(target, orchestrator));
		onOpen?.();
	}

	function select(id: string) {
		shellSessions.activeId = id;
		onOpen?.();
	}
</script>

<div class="flex items-center gap-1 border-b bg-background pr-1">
	<UnderlineTabs.Root
		class="min-w-0 flex-1 gap-0"
		value={shellSessions.activeId ?? ''}
		onValueChange={select}
	>
		<UnderlineTabs.List class="border-b-0">
			{#each shellSessions.shells as shell (shell.id)}
				{@const label = nameOf(shell.owner)}
				<UnderlineTabs.Trigger
					value={shell.id}
					class={shell.exited ? 'opacity-60' : ''}
					title={`Port ${shell.port}`}
				>
					{label}
					{#snippet trailing()}
						<Button
							variant="ghost"
							size="icon-xs"
							class="-ml-1.5"
							aria-label="Close {label}"
							onclick={() => shellSessions.close(shell.id)}
						>
							<XIcon />
						</Button>
					{/snippet}
				</UnderlineTabs.Trigger>
			{/each}
		</UnderlineTabs.List>
	</UnderlineTabs.Root>

	<ButtonGroup.Root class="shrink-0">
		<Button variant="ghost" size="sm" onclick={() => open(owner)}>
			<PlusIcon />
			New {owner.kind === 'admin' ? 'admin shell' : `shell for ${ownerName}`}
		</Button>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="ghost" size="icon-sm" aria-label="Open another shell">
						<ChevronDownIcon />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end">
				<DropdownMenu.Item onSelect={() => open({ kind: 'admin' })}>Admin</DropdownMenu.Item>
				{#each shellNodes as node (node.id)}
					<DropdownMenu.Item onSelect={() => open({ kind: 'node', nodeId: node.id })}>
						{nodeName(node)}
					</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</ButtonGroup.Root>
</div>
