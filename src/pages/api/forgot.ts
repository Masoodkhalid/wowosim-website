import type { APIRoute } from 'astro';
import { portalFetch } from '../../lib/api';

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json();
  const res = await portalFetch('/password/forgot', {
    method: 'POST',
    body: JSON.stringify({ email: body.email }),
  });
  const data = await res.json();
  if (res.ok) return new Response(JSON.stringify({ success: true }), { status: 200 });
  return new Response(JSON.stringify({ success: false, message: data.message ?? 'Not found' }), { status: res.status });
};
