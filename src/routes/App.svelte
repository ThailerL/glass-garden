<script lang="ts">
	import {
		SvelteFlow,
		Controls,
		Background,
		MarkerType,
		useSvelteFlow,
		type Node
	} from '@xyflow/svelte';
	import { v4 as uuidv4 } from 'uuid';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import AppSidebar from '$lib/components/AppSidebar.svelte';
	import LoadBalancerNode from '$lib/components/nodes/LoadBalancerNode.svelte';
	import FunctionNode from '$lib/components/nodes/FunctionNode.svelte';
	import ServiceNode from '$lib/components/nodes/ServiceNode.svelte';
	import { useDnD } from '$lib/components/DnDProvider.svelte';
	import { defaultNodeData } from '$lib/schemas';

	const nodeTypes = {
		loadBalancer: LoadBalancerNode,
		function: FunctionNode,
		service: ServiceNode
	};

	let nodes = $state.raw([
		{ id: uuidv4(), position: { x: 0, y: 0 }, type: 'function', data: defaultNodeData.function }
	]);

	let edges = $state.raw([]);

	const { screenToFlowPosition } = useSvelteFlow();

	const type = useDnD();

	const onDragOver = (event: DragEvent) => {
		event.preventDefault();

		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'move';
		}
	};

	const onDrop = (event: DragEvent) => {
		event.preventDefault();

		if (!type.current) {
			return;
		}

		const position = screenToFlowPosition({
			x: event.clientX,
			y: event.clientY
		});

		const newNode = {
			id: uuidv4(),
			type: type.current,
			position,
			data: defaultNodeData[type.current],
			origin: [0.5, 0.5]
		} satisfies Node;

		nodes = [...nodes, newNode];
	};
</script>

<Sidebar.Provider>
	<AppSidebar />
	<div style:width="100vw" style:height="100vh">
		<SvelteFlow
			bind:nodes
			bind:edges
			{nodeTypes}
			ondragover={onDragOver}
			ondrop={onDrop}
			defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }}
			fitView
			colorMode="system"
		>
			<Controls />
			<Background />
		</SvelteFlow>
	</div>
</Sidebar.Provider>
