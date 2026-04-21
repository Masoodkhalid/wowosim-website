import type { APIRoute } from 'astro';
import { portalFetch } from '../../lib/api';
import { getJwt, clearAuthCookie } from '../../lib/auth';

export const POST: APIRoute = async ({ cookies }) => {
  const jwt = getJwt(cookies);
  if (!jwt) return new Response(JSON.stringify({ success: false }), { status: 401 });
  const res = await portalFetch('/delete-account', { method: 'POST' }, jwt);
  if (res.ok) {
    clearAuthCookie(cookies);
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }
  return new Response(JSON.stringify({ success: false }), { status: res.status });
};
