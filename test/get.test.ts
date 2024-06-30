import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import {
	beforeAll,
	describe,
	expect,
	it,
} from 'vitest';

import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('worker - get', () => {
	beforeAll(async () => {
		env.AUTH_KEY = 'test';
		await env.R2_BUCKET.put('test.txt', new Uint8Array([1, 2, 3]));
		await env.R2_BUCKET.put('test2.txt', new Uint8Array([1, 2, 3]));
		await env.R2_BUCKET.put('test3.txt', new Uint8Array([1, 2, 3]));
	});

	it('list: responds with 401 for invalid auth', async () => {
		const request = new IncomingRequest('https://i.james.pub/files/list', {
			headers: {
				'x-auth-key': 'invalid',
			},
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(401);
		expect(await response.json()).toMatchInlineSnapshot(`
			{
			  "error": "Missing auth",
			  "success": false,
			}
		`);
	});

	it('list: responds with 200 for valid auth', async () => {
		const request = new IncomingRequest('https://i.james.pub/files/list', {
			headers: {
				'x-auth-key': 'test',
			},
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const results = await response.json();
		expect(results.objects).toHaveLength(3);
		expect(results.objects[0].key).toBe('test.txt');
		expect(results.objects[1].key).toBe('test2.txt');
		expect(results.objects[2].key).toBe('test3.txt');
	});

	it('file: responds correctly for valid auth', async () => {
		const request = new IncomingRequest('https://i.james.pub/file/test.txt');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/octet-stream');
		expect(response.headers.get('content-length')).toBe('3');
		expect(await response.arrayBuffer()).toStrictEqual(new Uint8Array([1, 2, 3]).buffer);
	});
});
