import type { APIRoute } from 'astro';
import { portalFetch } from '../../lib/api';
import { getJwt } from '../../lib/auth';

export const POST: APIRoute = async ({ request, cookies }) => {
  const jwt = getJwt(cookies);
  if (!jwt) return new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), { status: 401 });
  const body = await request.json();
  const res = await portalFetch('/me', { method: 'POST', body: JSON.stringify({ user: body.user }) }, jwt);
  const data = await res.json();
  if (res.ok) return new Response(JSON.stringify({ success: true, data }), { status: 200 });
  return new Response(JSON.stringify({ success: false, message: data.message ?? 'Update failed' }), { status: res.status });
};
