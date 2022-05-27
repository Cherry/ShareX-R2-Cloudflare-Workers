import {Router} from 'itty-router';
import render2 from 'render2';

interface Env {
	AUTH_KEY: string;
	R2_BUCKET: R2Bucket;
	CACHE_CONTROL?: string;
}

const router = Router();

// handle authentication
const authMiddleware = (request: Request, env: Env): Response | undefined => {
	const url = new URL(request.url);
	if(request.headers?.get("x-auth-key") !== env.AUTH_KEY && url.searchParams.get("authkey") !== env.AUTH_KEY){
		return new Response(JSON.stringify({
			success: false,
			error: 'Missing auth',
		}), {
			status: 401,
			headers: {
				"content-type": "application/json",
			},
		});
	}
};

// handle upload
router.post("/upload", authMiddleware, async (request: Request, env: Env): Promise<Response> => {
	const url = new URL(request.url);
	let fileslug = url.searchParams.get('filename');
	if(!fileslug){
		// generate random filename UUID if not set
		fileslug = crypto.randomUUID();
	}
	const date = new Date();
	const folder = `${date.getFullYear()}/${('0' + date.getMonth()).slice(-2)}`;
	const filename = `${folder}/${fileslug}`;

	// ensure content-length and content-type headers are present
	const contentType = request.headers.get('content-type');
	const contentLength = request.headers.get('content-length');
	if(!contentLength || !contentType){
		return new Response(JSON.stringify({
			success: false,
			message: "content-length and content-type are required",
		}), {
			status: 400,
			headers: {
				"content-type": "application/json",
			},
		});
	}

	// write to R2
	try{
		await env.R2_BUCKET.put(filename, request.body, {
			httpMetadata: {
				contentType: contentType,
				cacheControl: 'public, max-age=604800',
			},
		});
	}catch(error){
		return new Response(JSON.stringify({
			success: false,
			message: "Error occured writing to R2",
			error: {
				name: error.name,
				message: error.message,
			},
		}), {
			status: 500,
			headers: {
				"content-type": "application/json",
			},
		});
	}

	// return the image url to ShareX
	const returnUrl = new URL(request.url);
	returnUrl.searchParams.delete('filename');
	returnUrl.pathname = `/file/${filename}`;
	return new Response(JSON.stringify({
		success: true,
		image: returnUrl.href,
	}), {
		headers: {
			"content-type": "application/json",
		},
	});
});

// handle file retrieval
const getFile = async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
	const url = new URL(request.url);
	const id = url.pathname.slice(6);
	const notFound = error => new Response(JSON.stringify({
		success: false,
		error: error ?? 'Not Found',
	}), {
		status: 404,
		headers: {
			"content-type": "application/json",
		},
	});
	if(!id){
		return notFound('Missing ID');
	}

	const imageReq = new Request(`https://r2host/${id}`, request);
	return render2.fetch(imageReq, {
		...env,
		CACHE_CONTROL: 'public, max-age=604800',
	}, ctx);
};
router.get("/upload/:id", getFile);
router.get("/file/*", getFile);
router.head("/file/*", getFile);

router.get('/files/list', authMiddleware, async (request: Request, env: Env): Promise<Response> => {
	const items = await env.R2_BUCKET.list({limit: 1000});
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
		"content-type": "application/json",
	},
}));

export {router};