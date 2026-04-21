import type { AstroCookies } from 'astro';

export function getJwt(cookies: AstroCookies): string | null {
  return cookies.get('wordpress_wowouser')?.value ?? null;
}

export function isLoggedIn(cookies: AstroCookies): boolean {
  return !!getJwt(cookies);
}

export function setAuthCookie(cookies: AstroCookies, token: string) {
  cookies.set('wordpress_wowouser', `Bearer ${token}`, {
    maxAge: 172800,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
  });
}

export function clearAuthCookie(cookies: AstroCookies) {
  cookies.delete('wordpress_wowouser', { path: '/' });
}
