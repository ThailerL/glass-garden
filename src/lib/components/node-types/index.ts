import LoadBalancerNode from './LoadBalancerNode.svelte';
import FunctionNode from './FunctionNode.svelte';
import InstanceGroupNode from './InstanceGroupNode.svelte';

export const nodeTypes = {
	loadBalancer: LoadBalancerNode,
	function: FunctionNode,
	instanceGroup: InstanceGroupNode
};

export { LoadBalancerNode, FunctionNode, InstanceGroupNode };
