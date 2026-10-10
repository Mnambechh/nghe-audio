// Cloudflare Pages Functions: mọi đường dẫn (trừ /assets/*) đi qua đây.
import { handle } from '../src/app.js';
import { withSecurityHeaders } from '../src/security.js';

export async function onRequest(context) {
  try {
    const res = await handle(context.request, context.env, context);
    return withSecurityHeaders(res, res.headers.has('Content-Security-Policy'));
  } catch (err) {
    console.error(err && err.stack || err);
    return new Response('Có lỗi xảy ra, vui lòng thử lại sau.', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}
