export interface Env {
	AUTH_KEY: string;
	R2_BUCKET: R2Bucket;
	CACHE_CONTROL?: string;
	CUSTOM_PUBLIC_BUCKET_DOMAIN?: string;
	ONLY_ALLOW_ACCESS_TO_PUBLIC_BUCKET?: boolean;
}
