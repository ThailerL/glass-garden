import LoadBalancerSettings from './LoadBalancerSettings.svelte';
import FunctionSettings from './FunctionSettings.svelte';
import InstanceGroupSettings from './InstanceGroupSettings.svelte';

export const settingsTypes = {
	loadBalancer: LoadBalancerSettings,
	function: FunctionSettings,
	instanceGroup: InstanceGroupSettings
};

export { LoadBalancerSettings, FunctionSettings, InstanceGroupSettings as ServiceSettings };
