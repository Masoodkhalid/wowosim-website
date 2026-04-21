import type { APIRoute } from 'astro';
import { portalFetch } from '../../lib/api';

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json();
  const res = await portalFetch('/password/reset', {
    method: 'POST',
    body: JSON.stringify({
      reset_password_token: body.reset_password_token,
      password: body.password,
      password_confirmation: body.password_confirmation,
    }),
  });
  const data = await res.json();
  if (res.ok) return new Response(JSON.stringify({ success: true }), { status: 200 });
  return new Response(JSON.stringify({ success: false, message: data.message ?? 'Reset failed' }), { status: res.status });
};
