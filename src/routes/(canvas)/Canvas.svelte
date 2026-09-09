<script lang="ts">
	import { untrack } from 'svelte';
	import {
		SvelteFlow,
		Controls,
		Background,
		useSvelteFlow,
		type Node,
		useOnSelectionChange,
		type Edge,
		type OnDelete,
		type OnBeforeDelete,
		type NodeTargetEventWithPointer,
		type NodeEventWithPointer,
		type OnConnect,
		type IsValidConnection,
		type XYPosition
	} from '@xyflow/svelte';
	import { droppable, type DragDropState } from '@thisux/sveltednd';
	import { asset } from '$app/paths';
	import {
		canAddEdge,
		getResourceDefinition,
		resourceDefinitions,
		type ResourceType
	} from '$lib/resources';
	import { confirmDelete } from '$lib/components/ui/confirm-delete-dialog';
	import { askResourceName } from '$lib/components/ResourceNameDialog.svelte';
	import { buildNameValidator } from '$lib/resources/name-on-create';
	import SquareTerminalIcon from '@lucide/svelte/icons/square-terminal';
	import { Button } from '$lib/components/ui/button';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import ShellDock from '$lib/components/ShellDock.svelte';
	import { shellSessions } from '$lib/shell-sessions.svelte';
	import ResourceNode from './ResourceNode.svelte';
	import TrafficEdge from './TrafficEdge.svelte';
	import ProjectsGroup from './ProjectsGroup.svelte';
	import ResourcesGroup from './ResourcesGroup.svelte';
	import InspectorSidebar from '$lib/components/InspectorSidebar.svelte';
	import { inspectorState } from '$lib/inspector-state.svelte';
	import { getGraphState, nodeName } from '$lib/graph-state.svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import OrchestratorControls from './OrchestratorControls.svelte';
	import TourOverlay from '$lib/components/TourOverlay.svelte';
	import Workspace, { PANEL_FRACTION } from '$lib/components/Workspace.svelte';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { tour } from '$lib/tour.svelte';

	const graphState = getGraphState();
	const orchestrator = getOrchestrator();
	const { screenToFlowPosition, setCenter, getViewport, getNodesBounds, deleteElements } =
		useSvelteFlow();

	// Drives the layout, never what the canvas can do
	const isMobile = new IsMobile();
	// A touchscreen laptop drops a connection with the same finger at a desktop width
	const coarsePointer = new MediaQuery('pointer: coarse');

	// Offered once, on a first visit: the tour reads the canvas it is about to point at
	tour.begin(graphState.projectId, graphState.nodes);

	// Every resource type renders through the same component, which reads its icon and
	// handles from the node's own definition
	const nodeTypes = Object.fromEntries(
		Object.keys(resourceDefinitions).map((resource) => [resource, ResourceNode])
	);
	// Every edge fans into its target's instances and carries the dots in flight
	const edgeTypes = { default: TrafficEdge };

	// A node's directory goes with it, so the resources holding anything worth keeping ask
	// before the graph has parted with them
	const onBeforeDelete: OnBeforeDelete = ({ nodes }) => {
		const withContents = nodes.filter((node) => {
			const { ownsStoredData, hasEditableFiles } = getResourceDefinition(node.type);
			return ownsStoredData || hasEditableFiles;
		});
		if (withContents.length === 0) return Promise.resolve(true);

		const names = withContents.map(nodeName);
		return new Promise((resolve) => {
			confirmDelete({
				title: nodes.length === 1 ? `Delete "${names[0]}"?` : `Delete ${nodes.length} resources?`,
				description: `The files and data in ${names.join(', ')} are deleted too, and cannot be recovered.`,
				onConfirm: async () => resolve(true),
				onCancel: () => resolve(false)
			});
		});
	};

	const onDelete: OnDelete = ({ nodes, edges }) => {
		nodes.forEach((node) => graphState.deleteNodeFromStorage(node.id));
		edges.forEach((edge) => graphState.deleteEdgeFromStorage(edge.id));

		// Before remove, which deletes the node's directory: a shell must not be sitting in it
		nodes.forEach((node) => shellSessions.closeForNode(node.id));

		nodes.forEach((node) => orchestrator.remove(node));
		edges.forEach((edge) => orchestrator.refreshEdge(edge));
	};

	let shellDock = $state<ReturnType<typeof ShellDock>>();

	let selectedEdges: Edge[] = $state.raw([]);

	useOnSelectionChange(({ nodes, edges }) => {
		selectedEdges = edges;
		graphState.selectedNodeId = nodes.length === 1 ? nodes[0].id : undefined;
	});

	const restoredNodeId = untrack(() => graphState.selectedNodeId);
	const savedViewport = untrack(() => graphState.viewport);
	if (restoredNodeId) graphState.select(restoredNodeId);

	// Read from the restored id rather than from the selection callback, which announces changes
	// only: a return from the editor mounts the flow with its node already selected
	const showsInspector = $derived(!!graphState.selectedNodeId && selectedEdges.length === 0);

	// Once the panel is gone the next one is a fresh arrival rather than a swap, so it opens without the fade
	$effect(() => {
		if (!showsInspector) inspectorState.shownNodeId = undefined;
	});

	// A drag ends in a click on the node it moved, so the click is judged by what the gesture did
	let dragged = false;
	let selectedBeforeDrag: string | undefined;

	// xyflow drags every selected node, and clears the old one in the same tick it reads its
	// node lookup — a gesture early is what the lookup needs to catch up
	function onPointerDown(event: PointerEvent) {
		if (!isMobile.current) return;
		dragged = false;

		const pressed = (event.target as Element | null)?.closest('.svelte-flow__node');
		if (!pressed) return;

		selectedBeforeDrag = graphState.selectedNodeId;
		if (selectedBeforeDrag && selectedBeforeDrag !== pressed.getAttribute('data-id')) {
			graphState.select();
		}
	}

	// Every tap, not just an obscured node: with the panel open nothing tappable is obscured
	const onNodeClick: NodeEventWithPointer<MouseEvent | TouchEvent, Node> = ({ node }) => {
		if (!isMobile.current) return;

		// selectNodesOnDrag is off here, so this click is where xyflow selected the dragged node
		if (dragged) {
			graphState.select(selectedBeforeDrag);
			return;
		}

		const bounds = getNodesBounds([node.id]);
		if (!bounds.width) return;

		// Held sideways: a tap lands on something already in view, and recentring would push its
		// neighbours off the edge
		liftAbovePanel({
			x: screenToFlowPosition({ x: window.innerWidth / 2, y: 0 }).x,
			y: bounds.y + bounds.height / 2
		});
	};

	// The visible strip's middle is half the panel's height above the canvas's
	function liftAbovePanel(centre: XYPosition) {
		const { zoom } = getViewport();
		const lift = ((PANEL_FRACTION / 2) * window.innerHeight) / zoom;
		setCenter(centre.x, centre.y + lift, { zoom, duration: 300 });
	}

	let pointerPosition = { x: 0, y: 0 };
	function trackPointer(e: MouseEvent | PointerEvent) {
		pointerPosition = { x: e.clientX, y: e.clientY };
	}

	async function addResource(resource: ResourceType, position: XYPosition) {
		// Named before it exists, so the node is only created once the values are settled
		const { namedOnCreate } = getResourceDefinition(resource);
		let config: Record<string, unknown> | undefined;
		if (namedOnCreate) {
			config = await askResourceName({
				...namedOnCreate,
				validate: buildNameValidator(resource, graphState.nodes)
			});
			// Backing out of the dialog is a decision not to add the node at all
			if (!config) return;
		}

		const node = graphState.addNode(resource, position, { config });
		void orchestrator.mountFiles(node.id);
		// Reserves the new node's ports before it first renders
		orchestrator.refresh(node.id);
		graphState.select(node.id);
		return node;
	}

	function onDrop({ draggedItem, sourceContainer, targetContainer }: DragDropState<ResourceType>) {
		if (sourceContainer !== 'component-sidebar' || targetContainer !== 'canvas') {
			return;
		}
		void addResource(draggedItem, screenToFlowPosition(pointerPosition));
	}

	// Tapped adds all aim at one spot, so a new node steps right until it is clear
	const NODE_SPACING = 140;

	function clearOf(nodes: readonly Node[], spot: XYPosition): XYPosition {
		const taken = nodes.some(
			({ position }) =>
				Math.abs(position.x - spot.x) < NODE_SPACING && Math.abs(position.y - spot.y) < NODE_SPACING
		);
		return taken ? clearOf(nodes, { x: spot.x + NODE_SPACING, y: spot.y }) : spot;
	}

	// The panel the selection opens covers the bottom, so the middle is the strip's not the window's
	async function addResourceAtCentre(resource: ResourceType) {
		const position = clearOf(
			graphState.nodes,
			screenToFlowPosition({
				x: window.innerWidth / 2,
				y: ((1 - PANEL_FRACTION) * window.innerHeight) / 2
			})
		);
		// Sideways too: a stepped-aside node can be off the edge entirely. Only moves when the
		// spot was taken, so an uncontested add arrives without any motion
		if (await addResource(resource, position)) liftAbovePanel(position);
	}

	const onNodeDragStop: NodeTargetEventWithPointer<MouseEvent | TouchEvent, Node> = ({
		targetNode
	}) => {
		dragged = true;
		if (targetNode) graphState.setNodeInStorage(targetNode);
	};

	// The only way to delete without a keyboard. deleteElements is the same path the Delete key
	// takes, so the confirm dialog and the cleanup in ondelete both still run
	let contextMenu = $state<{ at: XYPosition; subject: string; remove: () => void }>();

	// The flow reports a point, not an element, so the menu hangs off a zero-size rect there
	const anchor = $derived.by(() => {
		const at = contextMenu?.at;
		return at && { getBoundingClientRect: () => new DOMRect(at.x, at.y, 0, 0) };
	});

	const onNodeContextMenu: NodeEventWithPointer<MouseEvent, Node> = ({ event, node }) => {
		event.preventDefault();
		contextMenu = {
			at: { x: event.clientX, y: event.clientY },
			subject: `"${nodeName(node)}"`,
			remove: () => void deleteElements({ nodes: [{ id: node.id }] })
		};
	};

	function onEdgeContextMenu({ event, edge }: { event: MouseEvent; edge: Edge }) {
		event.preventDefault();
		contextMenu = {
			at: { x: event.clientX, y: event.clientY },
			subject: 'connection',
			remove: () => void deleteElements({ edges: [{ id: edge.id }] })
		};
	}

	const isValidConnection: IsValidConnection = ({ source, target }) => {
		const sourceNode = graphState.getNode(source);
		const targetNode = graphState.getNode(target);
		return !!sourceNode && !!targetNode && canAddEdge(sourceNode, targetNode, graphState.edges);
	};

	const onConnect: OnConnect = (connection) => {
		const edge = graphState.edges.find(
			(edge) =>
				edge.source === connection.source &&
				edge.target === connection.target &&
				edge.sourceHandle == connection.sourceHandle &&
				edge.targetHandle == connection.targetHandle
		);
		if (edge) {
			orchestrator.refreshEdge(edge);
			graphState.setEdgeInStorage(edge);
		}
	};
</script>

{#snippet leftSidebar(dismiss: () => void)}
	<Sidebar.Root collapsible="none" class="w-full!">
		<Sidebar.Header class="flex-row items-center gap-2 px-3 pt-3 pb-1">
			<img src={asset('/favicon.svg')} alt="" class="size-6 shrink-0" />
			<span class="truncate font-semibold tracking-tight">Glass Garden</span>
			<a
				href="https://github.com/ThailerL/glass-garden"
				target="_blank"
				rel="noreferrer"
				title="Glass Garden on GitHub"
				class="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
			>
				<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" class="size-4">
					<path
						d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656"
					/>
				</svg>
				<span class="sr-only">GitHub</span>
			</a>
		</Sidebar.Header>
		<Sidebar.Content class="gap-0 pt-2">
			<ProjectsGroup />
			<Sidebar.Separator class="my-2" />
			<ResourcesGroup
				onTap={(resource) => {
					// Before the dialog a named resource opens, so the two are never up together
					dismiss();
					addResourceAtCentre(resource);
				}}
			/>
		</Sidebar.Content>
	</Sidebar.Root>
{/snippet}

{#snippet flow()}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="relative h-full w-full"
		ondragover={trackPointer}
		onpointerdowncapture={onPointerDown}
		use:droppable={{ container: 'canvas', callbacks: { onDrop } }}
	>
		<SvelteFlow
			bind:nodes={graphState.nodes}
			bind:edges={graphState.edges}
			{nodeTypes}
			{edgeTypes}
			deleteKey="Delete"
			onbeforedelete={onBeforeDelete}
			ondelete={onDelete}
			selectNodesOnDrag={!isMobile.current}
			onnodedragstop={onNodeDragStop}
			onnodeclick={onNodeClick}
			onnodecontextmenu={onNodeContextMenu}
			onedgecontextmenu={onEdgeContextMenu}
			onconnect={onConnect}
			{isValidConnection}
			onmoveend={(_, viewport) => (graphState.viewport = viewport)}
			initialViewport={savedViewport}
			fitView={!savedViewport}
			connectionRadius={coarsePointer.current ? 44 : 20}
			nodeDragThreshold={coarsePointer.current ? 8 : 1}
			colorMode="system"
			attributionPosition={isMobile.current ? 'bottom-right' : 'top-left'}
		>
			<Controls />
			<Background />
		</SvelteFlow>

		<!-- xterm needs a keyboard and a width a phone has neither of -->
		{#if !isMobile.current}
			<Button
				variant="outline"
				size="sm"
				class="absolute right-0 bottom-0 z-40 rounded-none rounded-tl-md border-r-0 border-b-0 shadow-none"
				onclick={() => shellDock?.toggle()}
			>
				<SquareTerminalIcon />
				Terminal
				{#if shellSessions.shells.length}
					<span class="text-muted-foreground tabular-nums">{shellSessions.shells.length}</span>
				{/if}
			</Button>
		{/if}
	</div>
{/snippet}

{#snippet mainContent()}
	<ShellDock bind:this={shellDock} owner={{ kind: 'admin' }} main={flow} />
{/snippet}

{#snippet inspector()}
	{#if graphState.selectedNodeId}
		{#key graphState.selectedNodeId}
			<InspectorSidebar nodeId={graphState.selectedNodeId} />
		{/key}
	{/if}
{/snippet}

<OrchestratorControls panelOpen={showsInspector} />

<ContextMenu.Root open={!!contextMenu} onOpenChange={(open) => open || (contextMenu = undefined)}>
	{#if contextMenu}
		<ContextMenu.Content customAnchor={anchor}>
			<ContextMenu.Item onSelect={contextMenu.remove}>
				Delete {contextMenu.subject}
			</ContextMenu.Item>
		</ContextMenu.Content>
	{/if}
</ContextMenu.Root>

<TourOverlay />

<Workspace
	{leftSidebar}
	{mainContent}
	rightSidebar={showsInspector ? inspector : undefined}
	onDismissRightSidebar={() => graphState.select()}
/>
