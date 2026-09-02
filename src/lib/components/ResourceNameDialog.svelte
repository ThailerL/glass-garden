<script lang="ts" module>
	import type { NamedOnCreate } from '$lib/resources/types';
	import type { NameIssues } from '$lib/resources/name-on-create';

	export type ResourceNameOptions = NamedOnCreate & {
		validate: (values: Record<string, string>) => NameIssues;
	};

	class ResourceNameDialogState {
		open = $state(false);
		values = $state<Record<string, string>>({});
		// A derived field follows its source until the user takes it over. Clearing it hands it
		// back, so a mistyped name can be re-linked rather than corrected twice
		touched = $state<Record<string, boolean>>({});
		options = $state<ResourceNameOptions | null>(null);
		#settle: ((values: Record<string, string> | undefined) => void) | undefined;

		trimmed = $derived(
			Object.fromEntries(Object.entries(this.values).map(([field, value]) => [field, value.trim()]))
		);

		issues = $derived(this.options?.validate(this.trimmed) ?? {});

		// Only complains about a field once it has been typed in, so the form does not open
		// covered in errors
		errors: NameIssues = $derived(
			Object.fromEntries(
				Object.entries(this.issues).map(([field, message]) => [
					field,
					this.values[field] ? message : undefined
				])
			)
		);

		canSubmit = $derived(
			(this.options?.fields ?? []).every(({ field }) => this.trimmed[field]) &&
				Object.values(this.issues).every((message) => message === undefined)
		);

		constructor() {
			this.submit = this.submit.bind(this);
			this.cancel = this.cancel.bind(this);
		}

		// The one writer for every input, so a field derived from another stays in step
		setValue(field: string, value: string) {
			this.values[field] = value;
			this.touched[field] = value.trim().length > 0;
			for (const other of this.options?.fields ?? []) {
				if (other.derive?.from === field && !this.touched[other.field]) {
					this.values[other.field] = other.derive.value(value);
				}
			}
		}

		ask(options: ResourceNameOptions) {
			this.options = options;
			this.values = Object.fromEntries(options.fields.map(({ field }) => [field, '']));
			this.touched = {};
			this.open = true;
			return new Promise<Record<string, string> | undefined>((resolve) => (this.#settle = resolve));
		}

		submit() {
			if (this.canSubmit) this.#settleWith(this.trimmed);
		}

		// Escape, the cancel button and a click outside are all the same decision: no node
		cancel() {
			this.#settleWith(undefined);
		}

		#settleWith(values: Record<string, string> | undefined) {
			this.open = false;
			this.#settle?.(values);
			this.#settle = undefined;
		}
	}

	const dialogState = new ResourceNameDialogState();

	// Resolves with the values, or undefined when the user backed out
	export function askResourceName(options: ResourceNameOptions) {
		return dialogState.ask(options);
	}
</script>

<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	// A description can single out the part that matters most - "permanent" on a name that
	// cannot be changed - without the definition having to carry markup
	function parts(description: string, emphasis?: string) {
		const at = emphasis ? description.indexOf(emphasis) : -1;
		if (!emphasis || at === -1) return { before: description, mark: '', after: '' };
		return {
			before: description.slice(0, at),
			mark: emphasis,
			after: description.slice(at + emphasis.length)
		};
	}
</script>

<Dialog.Root
	bind:open={dialogState.open}
	onOpenChange={(open) => {
		if (!open) dialogState.cancel();
	}}
>
	<Dialog.Content>
		<form
			method="POST"
			onsubmit={(e) => {
				e.preventDefault();
				dialogState.submit();
			}}
			class="flex flex-col gap-4"
		>
			<Dialog.Header>
				<Dialog.Title>{dialogState.options?.title}</Dialog.Title>
				<Dialog.Description>{dialogState.options?.description}</Dialog.Description>
			</Dialog.Header>
			{#each dialogState.options?.fields ?? [] as { field, label, description, emphasis }, index (field)}
				{@const error = dialogState.errors[field]}
				<div class="space-y-2">
					<Label for="resource-field-{field}">{label}</Label>
					<Input
						id="resource-field-{field}"
						autofocus={index === 0}
						value={dialogState.values[field] ?? ''}
						oninput={(e) => dialogState.setValue(field, e.currentTarget.value)}
						aria-invalid={error !== undefined}
					/>
					{#if error}
						<p class="text-sm font-medium text-destructive">{error}</p>
					{:else if description}
						{@const text = parts(description, emphasis)}
						<p class="text-sm text-muted-foreground">
							{text.before}<strong class="font-medium text-destructive">{text.mark}</strong
							>{text.after}
						</p>
					{/if}
				</div>
			{/each}
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={dialogState.cancel}>Cancel</Button>
				<Button type="submit" disabled={!dialogState.canSubmit}>Create</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
