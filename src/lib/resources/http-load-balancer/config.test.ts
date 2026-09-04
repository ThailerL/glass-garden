import { describe, expect, it } from 'vitest';
import { ADVANCED_FIELDS, hasAdvancedError, httpLoadBalancer } from './index';

// What the panel renders outside the disclosure
const VISIBLE_FIELDS = ['name', 'algorithm', 'healthCheckPath', 'healthCheckInterval'];

describe('the config panel covers the schema', () => {
	it('shows every setting either on the panel or behind the disclosure', () => {
		expect([...VISIBLE_FIELDS, ...ADVANCED_FIELDS].sort()).toEqual(
			Object.keys(httpLoadBalancer.configSchema.shape).sort()
		);
	});
});

describe('hasAdvancedError', () => {
	it('is false when nothing failed', () => {
		expect(hasAdvancedError({})).toBe(false);
	});

	it('is false for an error on a field the panel already shows', () => {
		expect(hasAdvancedError({ healthCheckInterval: ['Too small'] })).toBe(false);
	});

	it('is true for an error on a field behind the disclosure', () => {
		expect(hasAdvancedError({ matcher: ['Use status codes and ranges'] })).toBe(true);
	});
});

describe('the health check settings', () => {
	const parse = (config: Record<string, unknown>) =>
		httpLoadBalancer.configSchema.safeParse(config);

	it('defaults every setting, so a node created without any is complete', () => {
		expect(parse({}).data).toMatchObject({
			healthCheckPath: '/',
			healthCheckInterval: 5,
			healthCheckTimeout: 2,
			healthyThreshold: 2,
			unhealthyThreshold: 2,
			matcher: '200'
		});
	});

	it('refuses a timeout that is not shorter than the interval', () => {
		const result = parse({ healthCheckInterval: 5, healthCheckTimeout: 5 });
		expect(result.error?.issues.map(({ path }) => path)).toEqual([['healthCheckTimeout']]);
	});

	it('says nothing about the interval when the interval itself is invalid', () => {
		const result = parse({ healthCheckInterval: 1, healthCheckTimeout: 5 });
		expect(result.error?.issues.map(({ path }) => path)).toEqual([['healthCheckInterval']]);
	});

	it('accepts the matcher formats ALB accepts', () => {
		for (const matcher of ['200', '200,204', '200-299', ' 200, 300-399 ']) {
			expect(parse({ matcher }).success).toBe(true);
		}
	});

	it('refuses a matcher the balancer could not parse, which would empty the pool', () => {
		for (const matcher of ['', '2xx', '200,ok', '20-299']) {
			expect(parse({ matcher }).success).toBe(false);
		}
	});
});
