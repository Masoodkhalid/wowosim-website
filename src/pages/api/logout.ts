import type { APIRoute } from 'astro';
import { clearAuthCookie } from '../../lib/auth';

export const POST: APIRoute = async ({ cookies }) => {
  clearAuthCookie(cookies);
  return new Response(JSON.stringify({ success: true }), { status: 200 });
};
