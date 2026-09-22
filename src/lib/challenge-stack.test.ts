import { describe, expect, it } from 'vitest';
import { startingResources, suggestedResources, suggestionLine } from '$lib/challenge-stack';
import type { ChallengeDocument } from '$lib/project-document';
import type { ResourceType } from '$lib/resources';

// Only the fields the stack is read from; the rest of the document says nothing about it
const document = (canvas: { type: ResourceType; x: number }[], suggests: ResourceType[] = []) =>
	({
		suggests,
		startingCanvas: {
			nodes: canvas.map(({ type, x }, i) => ({
				id: `n${i}`,
				type,
				position: { x, y: 0 },
				config: {}
			}))
		}
	}) as unknown as ChallengeDocument;

describe('startingResources', () => {
	it('reads the canvas left to right, once per kind', () => {
		expect(
			startingResources(
				document([
					{ type: 'dynamodbTable', x: 420 },
					{ type: 'instanceGroup', x: 140 },
					{ type: 'httpLoadBalancer', x: -140 },
					{ type: 'instanceGroup', x: 700 }
				])
			)
		).toEqual(['httpLoadBalancer', 'instanceGroup', 'dynamodbTable']);
	});

	// It is the traffic rather than part of the system, and every challenge has one
	it('leaves out the request generator', () => {
		expect(
			startingResources(
				document([
					{ type: 'requestGenerator', x: 0 },
					{ type: 'instanceGroup', x: 200 }
				])
			)
		).toEqual(['instanceGroup']);
	});
});

describe('suggestedResources', () => {
	it('names what the canvas does not already have', () => {
		const slow = document([{ type: 'instanceGroup', x: 0 }], ['sqsQueue', 'lambdaFunction']);
		expect(suggestedResources(slow)).toEqual(['sqsQueue', 'lambdaFunction']);
	});

	// A challenge that starts with a queue is not suggesting one
	it('drops anything already on the starting canvas', () => {
		const started = document(
			[
				{ type: 'instanceGroup', x: 0 },
				{ type: 'sqsQueue', x: 200 }
			],
			['sqsQueue', 'lambdaFunction']
		);
		expect(suggestedResources(started)).toEqual(['lambdaFunction']);
	});

	it('is empty for a challenge that suggests nothing', () => {
		expect(suggestedResources(document([{ type: 'instanceGroup', x: 0 }]))).toEqual([]);
	});
});

describe('suggestionLine', () => {
	it('says nothing where nothing is suggested', () => {
		expect(suggestionLine([])).toBeUndefined();
	});

	it('labels the list rather than wrapping the names in a sentence', () => {
		expect(suggestionLine(['Queue (SQS)'])).toBe('Usually solved with: Queue (SQS)');
		expect(suggestionLine(['Queue (SQS)', 'Function (Lambda)'])).toBe(
			'Usually solved with: Queue (SQS), Function (Lambda)'
		);
	});
});
