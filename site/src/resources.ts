// What the app's resource definitions call each type, and the icon each one draws. Kept here
// rather than imported: a definition reaches for Svelte components, the container and the VM's
// virtual modules, none of which a static build can load. `resources.test.ts` in the app holds
// the two lists together
type Resource = { name: string; icon: string };

const RESOURCES: Record<string, Resource> = {
	instanceGroup: {
		name: 'Instance Group',
		icon: `<rect width="20" height="8" x="2" y="2" rx="2" /><rect width="20" height="8" x="2" y="14" rx="2" /><path d="M6 6h.01M6 18h.01" />`
	},
	lambdaFunction: {
		name: 'Function (Lambda)',
		icon: `<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 17c2 0 2.8-1 2.8-2.8V10c0-2 1-3.3 3.2-3" /><path d="M9 11.2h5.7" />`
	},
	httpLoadBalancer: {
		// Lucide's network branches downward, while a canvas reads left to right
		name: 'HTTP Load Balancer',
		icon: `<g transform="rotate(-90 12 12)"><rect x="16" y="16" width="6" height="6" rx="1" /><rect x="2" y="16" width="6" height="6" rx="1" /><rect x="9" y="2" width="6" height="6" rx="1" /><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" /><path d="M12 12V8" /></g>`
	},
	requestGenerator: {
		name: 'Request Generator',
		icon: `<path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" />`
	},
	postgres: {
		name: 'Postgres',
		icon: `<ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5V19A9 3 0 0 0 21 19V5" /><path d="M3 12A9 3 0 0 0 21 12" />`
	},
	s3Bucket: {
		name: 'Bucket (S3)',
		icon: `<rect width="20" height="5" x="2" y="3" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" />`
	},
	sqsQueue: {
		name: 'Queue (SQS)',
		icon: `<polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />`
	},
	dynamodbTable: {
		name: 'Table (DynamoDB)',
		icon: `<path d="M3 9h18" /><path d="M9 3v18" /><rect x="3" y="3" width="18" height="18" rx="2" />`
	},
	externalApi: {
		name: 'External API',
		icon: `<path d="M4.12 5.84A10 10 0 1 1 4.12 18.16" /><path d="M12 2a14.5 14.5 0 0 1 0 20" /><path d="M2 12h20" /><path d="m8 8 4 4-4 4" />`
	}
};

export const resourceTypes = Object.keys(RESOURCES);

export function resourceOf(type: string): Resource {
	const resource = RESOURCES[type];
	if (!resource) throw new Error(`No name or icon here for a "${type}" node`);
	return resource;
}

// What the node is under its name on the canvas: its kind, and the one setting a reader of the
// diagram would otherwise have to guess at
export function nodeSubtitle(type: string, config: Record<string, unknown>): string {
	const { name } = resourceOf(type);
	const count = config.instanceCount;
	if (typeof count !== 'number') return name;
	return `${name} · ${count === 1 ? '1 instance' : `${count} instances`}`;
}
