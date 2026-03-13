import type { Env as WorkerEnv } from '../src/types';

declare global {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace Cloudflare {
		// eslint-disable-next-line @typescript-eslint/no-empty-object-type
		interface Env extends WorkerEnv {}
	}
}
