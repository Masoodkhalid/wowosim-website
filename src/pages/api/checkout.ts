import type { APIRoute } from 'astro';
import { portalFetch } from '../../lib/api';
import { getJwt } from '../../lib/auth';

export const POST: APIRoute = async ({ request, cookies }) => {
  const jwt = getJwt(cookies);
  if (!jwt) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const body = await request.json();
  const res = await portalFetch('/checkout', {
    method: 'POST',
    body: JSON.stringify({ line_items: body.line_items }),
  }, jwt);
  const data = await res.text();
  return new Response(data, { status: res.status, headers: { 'Content-Type': 'application/json' } });
};
