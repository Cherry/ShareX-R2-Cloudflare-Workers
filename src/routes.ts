import { Router } from 'itty-router';
import render2 from 'render2';

import type { Env } from './types';
import type { IRequestStrict } from 'itty-router';


type CF = [env: Env, ctx: ExecutionContext];
const router = Router<IRequestStrict, CF>();

// handle authentication
const authMiddleware = (request: IRequestStrict, env: Env) => {
	const url = new URL(request.url);
	if (request.headers?.get('x-auth-key') !== env.AUTH_KEY && url.searchParams.get('authkey') !== env.AUTH_KEY) {
		return new Response(JSON.stringify({
			success: false,
			error: 'Missing auth',
		}), {
			status: 401,
			headers: {
				'content-type': 'application/json',
			},
		});
	}
};

const notFound = (error: string) => new Response(JSON.stringify({
	success: false,
	error: error ?? 'Not Found',
}), {
	status: 404,
	headers: {
		'content-type': 'application/json',
	},
});

const getError = (error: unknown) => {
	const errorObj = {
		name: 'Error',
		message: 'Unknown internal error',
	};
	if (error instanceof Error) {
		errorObj.name = error.name;
		errorObj.message = error.message;
	}
	return errorObj;
};

// handle upload
router.post('/upload', authMiddleware, async (request, env) => {
	const url = new URL(request.url);
	let fileslug = url.searchParams.get('filename');
	if (!fileslug) {
		// generate random filename UUID if not set
		fileslug = crypto.randomUUID();
	}
	const date = new Date();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const folder = `${date.getFullYear()}/${month}`;
	const filename = `${folder}/${fileslug}`;

	// ensure content-length and content-type headers are present
	const contentType = request.headers.get('content-type');
	const contentLength = request.headers.get('content-length');
	if (!contentLength || !contentType) {
		return new Response(JSON.stringify({
			success: false,
			message: 'content-length and content-type are required',
		}), {
			status: 400,
			headers: {
				'content-type': 'application/json',
			},
		});
	}

	// write to R2
	try {
		await env.R2_BUCKET.put(filename, request.body, {
			httpMetadata: {
				contentType: contentType,
				cacheControl: 'public, max-age=604800',
			},
		});
	} catch (error) {
		return new Response(JSON.stringify({
			success: false,
			message: 'Error occured writing to R2',
			error: getError(error),
		}), {
			status: 500,
			headers: {
				'content-type': 'application/json',
			},
		});
	}

	// return the image url to ShareX
	const returnUrl = new URL(request.url);
	returnUrl.searchParams.delete('filename');
	returnUrl.pathname = `/file/${filename}`;
	if (env.CUSTOM_PUBLIC_BUCKET_DOMAIN) {
		returnUrl.host = env.CUSTOM_PUBLIC_BUCKET_DOMAIN;
		returnUrl.pathname = filename;
	}

	const deleteUrl = new URL(request.url);
	deleteUrl.pathname = '/delete';
	deleteUrl.searchParams.set('authkey', env.AUTH_KEY);
	deleteUrl.searchParams.set('filename', filename);

	return new Response(JSON.stringify({
		success: true,
		image: returnUrl.href,
		deleteUrl: deleteUrl.href,
	}), {
		headers: {
			'content-type': 'application/json',
		},
	});
});

// handle file retrieval
const getFile = async (request: IRequestStrict, env: Env, ctx: ExecutionContext) => {
	if (env.ONLY_ALLOW_ACCESS_TO_PUBLIC_BUCKET) {
		return notFound('Not Found');
	}
	const url = new URL(request.url);
	const id = url.pathname.slice(6);

	if (!id) {
		return notFound('Missing ID');
	}

	const imageReq = new Request(`https://r2host/${id}`, request);
	return render2.fetch(imageReq, {
		...env,
		CACHE_CONTROL: 'public, max-age=604800',
	}, ctx);
};

// handle file deletion
router.get('/delete', authMiddleware, async (request, env) => {
	const url = new URL(request.url);
	const filename = url.searchParams.get('filename');

	if (!filename) {
		return notFound('Missing filename');
	}

	// delete from R2
	try {
		const cache = caches.default;
		await cache.delete(new Request(`https://r2host/${filename}`, request));

		await env.R2_BUCKET.delete(filename);
		return new Response(JSON.stringify({
			success: true,
		}), {
			headers: {
				'content-type': 'application/json',
			},
		});
	} catch (error) {
		return new Response(JSON.stringify({
			success: false,
			message: 'Error occurred deleting from R2',
			error: getError(error),
		}), {
			status: 500,
			headers: {
				'content-type': 'application/json',
			},
		});
	}
});

router.get('/upload/:id', getFile);
router.get('/file/*', getFile);
router.head('/file/*', getFile);

router.get('/files/list', authMiddleware, async (request, env) => {
	const items = await env.R2_BUCKET.list({ limit: 1000 });
	return new Response(JSON.stringify(items, null, 2), {
		headers: {
			'content-type': 'application/json',
		},
	});
});

// 404 everything else
router.all('*', (): Response => new Response(JSON.stringify({
	success: false,
	error: 'Not Found',
}), {
	status: 404,
	headers: {
		'content-type': 'application/json',
	},
}));

export { router };
