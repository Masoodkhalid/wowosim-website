import type { APIRoute } from 'astro';
import { portalFetch } from '../../lib/api';
import { setAuthCookie } from '../../lib/auth';

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await request.json();
  const res = await portalFetch('/users/sign_in', {
    method: 'POST',
    body: JSON.stringify({ user: body.user }),
  });
  const data = await res.json();
  if (res.ok && data.token) {
    setAuthCookie(cookies, data.token);
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }
  return new Response(JSON.stringify({ success: false, message: data.message ?? data.error ?? 'Invalid credentials' }), { status: 401 });
};
