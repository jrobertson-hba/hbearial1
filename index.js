// HBAerial quote-request mailer (Cloudflare Worker)
// Receives the website's quote form (JSON POST) and emails it to TO_EMAIL.

const LIMITS = {
  name: 100, company: 150, email: 254, phone: 40, service: 120,
  project_size_acres: 20, location: 200, frequency: 20, timeline: 40,
  addons: 300, notes: 4000,
};

const ONE_LINE = new Set(Object.keys(LIMITS).filter((k) => k !== 'notes'));

function clean(body) {
  const out = {};
  for (const [key, max] of Object.entries(LIMITS)) {
    let v = body[key] == null ? '' : String(body[key]);
    if (ONE_LINE.has(key)) v = v.replace(/[\r\n]+/g, ' '); // blocks header injection
    out[key] = v.trim().slice(0, max);
  }
  return out;
}

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export default {
  async fetch(request, env) {
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const origin = request.headers.get('Origin') || '';
    const originOk = allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': originOk ? origin : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: originOk ? 204 : 403, headers: cors });
    }
    if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405, cors);
    if (!originOk) return json({ ok: false, error: 'origin_not_allowed' }, 403, cors);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: 'invalid_json' }, 400, cors);
    }
    if (!body || typeof body !== 'object') return json({ ok: false, error: 'invalid_json' }, 400, cors);

    // Spam trap: pretend success so bots learn nothing
    if (body.website) return json({ ok: true }, 200, cors);

    const f = clean(body);
    if (!f.name || !f.service || !f.location || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(f.email)) {
      return json({ ok: false, error: 'missing_or_invalid_fields' }, 400, cors);
    }

    const lines = [
      ['Name', f.name],
      ['Company', f.company || '-'],
      ['Email', f.email],
      ['Phone', f.phone || '-'],
      ['Service', f.service],
      ['Project size', f.project_size_acres ? `${f.project_size_acres} acres` : '-'],
      ['Location', f.location],
      ['Frequency', f.frequency || '-'],
      ['Timeline', f.timeline || '-'],
      ['Add-ons', f.addons || 'None'],
    ];
    const text = lines.map(([k, v]) => `${k}: ${v}`).join('\n') + `\n\nNotes:\n${f.notes || '-'}\n`;
    const html =
      '<table cellpadding="6" style="font-family:Arial,sans-serif;font-size:14px">' +
      lines.map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`).join('') +
      '</table>' +
      `<p style="font-family:Arial,sans-serif;font-size:14px"><b>Notes</b><br>${esc(f.notes || '-').replace(/\n/g, '<br>')}</p>`;

    try {
      await env.EMAIL.send({
        to: env.TO_EMAIL,
        from: { email: env.FROM_EMAIL, name: 'HBAerial Website' },
        replyTo: { email: f.email, name: f.name },
        subject: `Quote request: ${f.service} (${f.name})`,
        text,
        html,
      });
    } catch (e) {
      console.error('Email send failed:', e && e.code, e && e.message);
      return json({ ok: false, error: 'send_failed' }, 502, cors);
    }
    return json({ ok: true }, 200, cors);
  },
};
