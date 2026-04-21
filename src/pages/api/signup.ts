import type { APIRoute } from 'astro';
import { portalFetch } from '../../lib/api';

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json();
  const res = await portalFetch('/users', {
    method: 'POST',
    body: JSON.stringify({ user: body.user }),
  });
  const data = await res.json();
  if (res.ok) return new Response(JSON.stringify({ success: true, data }), { status: 200 });
  return new Response(JSON.stringify({ success: false, message: data.message ?? 'Registration failed' }), { status: res.status });
};
