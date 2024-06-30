import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import {
	beforeAll,
	describe,
	expect,
	it,
} from 'vitest';

import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('worker - list upload', () => {
	beforeAll(async () => {
		env.AUTH_KEY = 'test';
		await env.R2_BUCKET.put('test.txt', new Uint8Array([1, 2, 3]));
		await env.R2_BUCKET.put('test2.txt', new Uint8Array([1, 2, 3]));
		await env.R2_BUCKET.put('test3.txt', new Uint8Array([1, 2, 3]));
	});

	it('list: responds correctly after upload', async () => {
		const file = new File(['test'], 'test-upload.txt');
		const request = new IncomingRequest('https://i.james.pub/upload?filename=test-upload', {
			method: 'POST',
			body: file,
			headers: {
				'x-auth-key': 'test',
				'content-length': '4',
				'content-type': 'text/plain',
			},
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);

		const urlParams = new URLSearchParams();
		urlParams.set('filename', 'test-upload');
		urlParams.set('authkey', 'test');

		const listRequest = new IncomingRequest('https://i.james.pub/files/list', {
			headers: {
				'x-auth-key': 'test',
			},
		});
		const listCtx = createExecutionContext();
		const listResponse = await worker.fetch(listRequest, env, listCtx);
		await waitOnExecutionContext(listCtx);
		expect(listResponse.status).toBe(200);
		const results = await listResponse.json();

		const date = new Date();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const folder = `${date.getFullYear()}/${month}`;

		expect(results.objects).toHaveLength(4);
		const sortedBuKey = results.objects.sort((itemA: R2Object, itemN: R2Object) => itemA.key.localeCompare(itemN.key));
		expect(sortedBuKey).toEqual(
			[
				expect.objectContaining({ key: `${folder}/test-upload` }),
				expect.objectContaining({ key: 'test.txt' }),
				expect.objectContaining({ key: 'test2.txt' }),
				expect.objectContaining({ key: 'test3.txt' }),
			],
		);
	});
});
