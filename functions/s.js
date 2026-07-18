// Cloudflare Pages Function — serves the per-run share page on the GAME domain
// (trybullrush.xyz/s?...) so the link people see is clean & branded. It hands X
// a dynamic OG card (rendered by the Railway API) then bounces humans to the game.

const CARD_API = 'https://api.trybullrush.xyz/api/card.png';

const esc = (s) =>
    String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

export function onRequestGet(context) {
    const url = new URL(context.request.url);
    const d = (url.searchParams.get('d') || '0').replace(/[^0-9]/g, '').slice(0, 9) || '0';
    const n = (url.searchParams.get('n') || 'ANON').slice(0, 16);
    const r = (url.searchParams.get('r') || '').slice(0, 24);

    const card = `${CARD_API}?d=${encodeURIComponent(d)}&n=${encodeURIComponent(n)}&r=${encodeURIComponent(r)}`;
    const game = `${url.origin}/`;
    const title = esc(`${n} charged ${Number(d).toLocaleString()}m in BULL RUSH`);
    const desc = esc(`Rank: ${r || 'Unverified'}. Replay-verified. Same grid. Prove the run.`);

    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${esc(card)}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${esc(card)}">
<meta http-equiv="refresh" content="0;url=${esc(game)}">
</head><body style="background:#05060a;color:#39ff14;font-family:monospace;text-align:center;padding-top:48px">
Charging into BULL RUSH… <a style="color:#39ff14" href="${esc(game)}">tap to play</a></body></html>`;

    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
