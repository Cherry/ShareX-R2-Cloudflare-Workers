import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import {
	beforeAll,
	describe,
	expect,
	it,
} from 'vitest';

import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('worker - upload CUSTOM_PUBLIC_BUCKET_DOMAIN', () => {
	beforeAll(async () => {
		env.AUTH_KEY = 'test';
		env.CUSTOM_PUBLIC_BUCKET_DOMAIN = 'example.com';
		await env.R2_BUCKET.put('test.txt', new Uint8Array([1, 2, 3]));
	});

	it('upload: responds with 400 for missing content-length/type', async () => {
		const file = new File(['test'], 'test-upload.txt');
		const request = new IncomingRequest('https://i.james.pub/upload', {
			method: 'POST',
			body: file,
			headers: {
				'x-auth-key': 'test',
			},
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchInlineSnapshot(`
			{
			  "message": "content-length and content-type are required",
			  "success": false,
			}
		`);
	});

	it('upload: responds correctly for valid auth', async () => {
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
		const results = await response.json();

		const date = new Date();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const folder = `${date.getFullYear()}/${month}`;

		expect(results.success).toBe(true);
		expect(results.image).toBe(`https://${env.CUSTOM_PUBLIC_BUCKET_DOMAIN}/${folder}/test-upload`);

		const urlParams = new URLSearchParams();
		urlParams.set('filename', `${folder}/test-upload`);
		urlParams.set('authkey', 'test');
		expect(results.deleteUrl).toBe(`https://i.james.pub/delete?${urlParams}`);
	});
});
