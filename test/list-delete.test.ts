import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import {
	beforeAll,
	describe,
	expect,
	it,
} from 'vitest';

import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('worker - list delete', () => {
	beforeAll(async () => {
		env.AUTH_KEY = 'test';
		await env.R2_BUCKET.put('test.txt', new Uint8Array([1, 2, 3]));
		await env.R2_BUCKET.put('test2.txt', new Uint8Array([1, 2, 3]));
		await env.R2_BUCKET.put('test3.txt', new Uint8Array([1, 2, 3]));
	});

	it('list: responds correctly after delete', async () => {
		// delete test2.txt
		const deleteRequest = new IncomingRequest('https://i.james.pub/delete?filename=test2.txt', {
			headers: {
				'x-auth-key': 'test',
			},
		});
		const deleteCtx = createExecutionContext();
		const deleteResponse = await worker.fetch(deleteRequest, env, deleteCtx);
		await waitOnExecutionContext(deleteCtx);
		expect(deleteResponse.status).toBe(200);
		expect(await deleteResponse.json()).toMatchInlineSnapshot(`
			{
			  "success": true,
			}
		`);

		// so now only test.txt and test3.txt should be left
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
		expect(results.objects).toHaveLength(2);
		expect(results.objects[0].key).toBe('test.txt');
		expect(results.objects[1].key).toBe('test3.txt');
	});
});
