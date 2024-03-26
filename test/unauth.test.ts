import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('worker - unauthenticated', () => {
	it('responds with 404 for unknown route', async () => {
		const request = new IncomingRequest('https://i.james.pub/404');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(404);
		expect(await response.json()).toMatchInlineSnapshot(`
			{
			  "error": "Not Found",
			  "success": false,
			}
		`);
	});

	it('file: responds with 404 for missing file', async () => {
		const request = new IncomingRequest('https://i.james.pub/file/missing');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(404);
		expect(await response.text()).toMatchInlineSnapshot('"File Not Found"');
	});

	it('file: responds with 404 for no filename', async () => {
		const request = new IncomingRequest('https://i.james.pub/file/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(404);
		expect(await response.json()).toMatchInlineSnapshot(`
			{
			  "error": "Missing ID",
			  "success": false,
			}
		`);
	});

	it('list: responds with 401 for missing auth', async () => {
		const request = new IncomingRequest('https://i.james.pub/files/list');
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

	it('delete: responds with 401 for missing auth', async () => {
		const request = new IncomingRequest('https://i.james.pub/delete?filename=test');
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

	it('upload: responds with 401 for missing auth', async () => {
		const file = new File(['test'], 'test.txt');
		const request = new IncomingRequest('https://i.james.pub/upload', {
			method: 'POST',
			body: file,
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
});
