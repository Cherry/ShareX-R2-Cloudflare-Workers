import {Router} from 'itty-router';
import parseRange from "range-parser";

const router = Router();

// handle authentication
const authMiddleware = (request, env) => {
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
router.post("/upload", authMiddleware, async (request, env) => {
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
function hasBody(object){
	return object.body !== undefined;
}

// handle file retrieval
const getFile = async (request, env, ctx) => {
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

	/* Much of this code has been re-used from https://github.com/kotx/render */
	/* MIT License: Kot. https://github.com/kotx/render/blob/master/LICENSE */
	const cache = caches.default;
	let response = await cache.match(request);
	let range;

	if(!response || !response.ok){
		// no cache match, try reading from R2
		const path = id;
		let file;

		// Range handling
		if(request.method === "GET"){
			const rangeHeader = request.headers.get("range");
			if(rangeHeader){
				file = await env.R2_BUCKET.head(path);
				if(file === null){ return notFound(); }
				const parsedRanges = parseRange(file.size, rangeHeader);
				// R2 only supports 1 range at the moment, reject if there is more than one
				if(parsedRanges !== -1 && parsedRanges !== -2 && parsedRanges.length === 1 && parsedRanges.type === "bytes"){
					const firstRange = parsedRanges[0];
					range = {
						offset: firstRange.start,
						length: firstRange.end - firstRange.start + 1,
					};
				}else{
					return new Response("Range Not Satisfiable", {status: 416});
				}
			}
		}

		// Etag/If-(Not)-Match handling
		// R2 requires that etag checks must not contain quotes, and the S3 spec only allows one etag
		// This silently ignores invalid or weak (W/) headers
		const getHeaderEtag = header => header?.trim().replace(/^["']|["']$/g, "");
		const ifMatch = getHeaderEtag(request.headers.get("if-match"));
		const ifNoneMatch = getHeaderEtag(request.headers.get("if-none-match"));

		const ifModifiedSince = Date.parse(request.headers.get("if-modified-since") || "");
		const ifUnmodifiedSince = Date.parse(request.headers.get("if-unmodified-since") || "");

		const ifRange = request.headers.get("if-range");
		if(range && ifRange && file){
			const maybeDate = Date.parse(ifRange);

			if((Number.isNaN(maybeDate) || new Date(maybeDate) > file.uploaded) && (ifRange.startsWith("W/") || ifRange !== file.httpEtag)){
				range = undefined;
			}
		}

		if(ifMatch || ifUnmodifiedSince){
			file = await env.R2_BUCKET.get(path, {
				onlyIf: {
					etagMatches: ifMatch,
					uploadedBefore: ifUnmodifiedSince ? new Date(ifUnmodifiedSince) : undefined,
				}, range,
			});

			if(file && !hasBody(file)){
				return new Response("Precondition Failed", {status: 412});
			}
		}

		if(ifNoneMatch || ifModifiedSince){
			// if-none-match overrides if-modified-since completely
			if(ifNoneMatch){
				file = await env.R2_BUCKET.get(path, {onlyIf: {etagDoesNotMatch: ifNoneMatch}, range});
			}else if(ifModifiedSince){
				file = await env.R2_BUCKET.get(path, {onlyIf: {uploadedAfter: new Date(ifModifiedSince)}, range});
			}
			if(file && !hasBody(file)){
				return new Response(null, {status: 304});
			}
		}

		if(request.method === 'HEAD'){
			file = await env.R2_BUCKET.head(path);
		}else if(!file || !hasBody(file)){
			file = await env.R2_BUCKET.get(path, {range});
		}

		if(file === null){
			return notFound();
		}

		response = new Response(hasBody(file) ? file.body : null, {
			status: (file?.size || 0) === 0 ? 204 : (range ? 206 : 200),
			headers: {
				"accept-ranges": "bytes",

				"etag": file.httpEtag,
				"cache-control": file.httpMetadata.cacheControl ?? 'public, max-age=604800',
				"expires": file.httpMetadata.cacheExpiry?.toUTCString() ?? "",
				"last-modified": file.uploaded.toUTCString(),

				"content-encoding": file.httpMetadata?.contentEncoding ?? "",
				"content-type": file.httpMetadata?.contentType ?? "application/octet-stream",
				"content-language": file.httpMetadata?.contentLanguage ?? "",
				"content-disposition": file.httpMetadata?.contentDisposition ?? "",
				"content-range": range ? `bytes ${range.offset}-${range.offset + range.length - 1}/${file.size}` : "",
			},
		});
	}
	// store in cache asynchronously, so to not hold up the request
	if(request.method === "GET" && !range){
		ctx.waitUntil(cache.put(request, response.clone()));
	}
	// return uploaded image, etc.
	return response;
};
router.get("/upload/:id", getFile);
router.get("/file/*", getFile);
router.head("/file/*", getFile);

router.get('/files/list', authMiddleware, async (request, env) => {
	const items = await env.R2_BUCKET.list({limit: 1000});
	return new Response(JSON.stringify(items, null, 2), {
		headers: {
			'content-type': 'application/json',
		},
	});
});

// 404 everything else
router.all('*', () => new Response(JSON.stringify({
	success: false,
	error: 'Not Found',
}), {
	status: 404,
	headers: {
		"content-type": "application/json",
	},
}));

export {router};