import LoadBalancerNode from './LoadBalancerNode.svelte';
import FunctionNode from './FunctionNode.svelte';
import ServiceNode from './ServiceNode.svelte';

export const nodeTypes = {
	loadBalancer: LoadBalancerNode,
	function: FunctionNode,
	service: ServiceNode
};

export { LoadBalancerNode, FunctionNode, ServiceNode };
