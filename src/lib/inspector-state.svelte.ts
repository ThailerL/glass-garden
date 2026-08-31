class InspectorState {
	tab = $state('config');
	shownNodeId = $state<string | undefined>(undefined);
}

export const inspectorState = new InspectorState();
