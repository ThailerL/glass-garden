import { embedded } from '$lib/embed';
import { IsMobile } from './is-mobile.svelte';

// A surface whose width is not ours to spend: a phone, or a frame in another site's page
export class IsCompact {
	#mobile = new IsMobile();

	get current() {
		return embedded || this.#mobile.current;
	}
}
