// Cloudflare Pages Functions: mọi đường dẫn (trừ /assets/*) đi qua đây.
import { handle } from '../src/app.js';

export async function onRequest(context) {
  try {
    return await handle(context.request, context.env, context);
  } catch (err) {
    console.error(err && err.stack || err);
    return new Response('Có lỗi xảy ra, vui lòng thử lại sau.', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}
