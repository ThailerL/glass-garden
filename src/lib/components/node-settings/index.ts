import LoadBalancerSettings from './LoadBalancerSettings.svelte';
import FunctionSettings from './FunctionSettings.svelte';
import ServiceSettings from './ServiceSettings.svelte';

export const settingsTypes = {
	loadBalancer: LoadBalancerSettings,
	function: FunctionSettings,
	service: ServiceSettings
};

export { LoadBalancerSettings, FunctionSettings, ServiceSettings };
