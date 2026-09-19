// Cloudflare Worker entry — static assets + /api/* routes (TASKS.md T27/T32).
// Routes:
//   GET /                     -> the app itself, served inline from the single asset (no redirect, T80)
//   /api/*                    -> api.handleApi (health / leaderboard / submit)
//   everything else           -> static assets (env.ASSETS), asset miss falls through here.

import { handleApi } from './api.mjs';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/') {
      // The root domain IS the app (T80 / baseline Appendix A-5): serve the single-file
      // asset directly at "/" — no redirect to the /src path. The file stays single-copy
      // under /src for the test suites and direct/back-compat access.
      return env.ASSETS.fetch(new Request(new URL('/src/llm-perf-bench.html', url).toString(), { method: 'GET' }));
    }

    if (path.startsWith('/api/')) {
      return handleApi(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
