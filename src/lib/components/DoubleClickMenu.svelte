<script lang="ts">
	import { useSvelteFlow, useUpdateNodeInternals } from '@xyflow/svelte';

	import * as Dialog from '$lib/components/ui/dialog';
	import * as Form from '$lib/components/ui/form';
	import { defaultNodeData } from '$lib/schemas';

	let { data, id, children, form, node, onMenuOpen = () => {}, onSave = () => {} } = $props();
	const { updateNodeData, getNode } = useSvelteFlow();
	const updateNodeInternals = useUpdateNodeInternals();
	const { form: formData, validateForm, errors, enhance } = form;

	let isOpen = $state(false);
	function openMenu() {
		form.reset({ data, newState: data });
		isOpen = true;
		onMenuOpen();
	}

	async function handleSubmit(event: Event) {
		event.preventDefault();
		const result = await validateForm();

		if (!result.valid) {
			errors.update((v) => {
				return {
					...v,
					...result.errors
				};
			});

			return;
		}

		isOpen = false;
		updateNodeData(id, $formData);
		onSave();
		updateNodeInternals(id);
	}
</script>

<div
	class="cursor-pointer"
	ondblclick={openMenu}
	role="button"
	tabindex="0"
	style:width="100%"
	style:height="100%"
>
	{@render node()}
</div>

<Dialog.Root bind:open={isOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Settings for {data.name}</Dialog.Title>
			<Dialog.Description
				>Make changes to this {defaultNodeData[getNode(id)?.type].name} here</Dialog.Description
			>
		</Dialog.Header>
		<form method="POST" use:enhance onsubmit={handleSubmit}>
			<div class="grid gap-4">
				{@render children()}
			</div>
			<Dialog.Footer>
				<Form.Button type="submit">Save changes</Form.Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
