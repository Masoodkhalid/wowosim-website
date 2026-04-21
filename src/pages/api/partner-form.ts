import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json();
  const { name, email, phone, business, message } = body;

  if (!name || !email) {
    return new Response(JSON.stringify({ success: false, message: 'Name and email are required' }), { status: 400 });
  }

  const data = { name, email, phone, business, message, timestamp: new Date().toISOString() };

  // Send to Google Sheets
  try {
    await fetch('https://script.google.com/macros/s/AKfycbygnkzw8vRj1cNAAT3p7q3K9HtFDqhi5zlGQ6zyLzdpLsQzL858a1buVYOmb0h0BnkdJw/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch {}

  return new Response(JSON.stringify({
    success: true,
    message: 'Thank you! Your partnership inquiry has been submitted. Check your email for confirmation.',
  }), { status: 200 });
};
