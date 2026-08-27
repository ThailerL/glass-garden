import Root, {
	type ButtonProps,
	type ButtonSize,
	type ButtonVariant,
	buttonVariants
} from './button.svelte';
import Loading, { type LoadingButtonProps, type Size, sizeMap } from './loading-button.svelte';

export {
	Root,
	type ButtonProps as Props,
	//
	Root as Button,
	buttonVariants,
	type ButtonProps,
	type ButtonSize,
	type ButtonVariant,
	//
	Loading as LoadingButton,
	type LoadingButtonProps,
	type Size,
	sizeMap
};
