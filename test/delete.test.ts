import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import {
	beforeAll,
	describe,
	expect,
	it,
} from 'vitest';

import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('worker - delete', () => {
	beforeAll(async () => {
		env.AUTH_KEY = 'test';
		await env.R2_BUCKET.put('test.txt', new Uint8Array([1, 2, 3]));
		await env.R2_BUCKET.put('test2.txt', new Uint8Array([1, 2, 3]));
		await env.R2_BUCKET.put('test3.txt', new Uint8Array([1, 2, 3]));
	});
	it('delete: responds correctly for valid auth', async () => {
		const request = new IncomingRequest('https://i.james.pub/delete?filename=test.txt', {
			headers: {
				'x-auth-key': 'test',
			},
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchInlineSnapshot(`
			{
			  "success": true,
			}
		`);
	});

	it('delete: after deleting, file is gone', async () => {
		const request = new IncomingRequest('https://i.james.pub/delete?filename=test2.txt', {
			headers: {
				'x-auth-key': 'test',
			},
		});
		const ctx = createExecutionContext();
		await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		const request2 = new IncomingRequest('https://i.james.pub/file/test2.txt');
		const ctx2 = createExecutionContext();
		const response2 = await worker.fetch(request2, env, ctx2);
		await waitOnExecutionContext(ctx);
		expect(response2.status).toBe(404);
	});
});
