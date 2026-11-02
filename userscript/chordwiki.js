// ChordWiki song pages, replaced by the nemutai Chord Editor view: the
// timeline, preview and player fill the page, under a thin strip that keeps
// ChordWiki's own menu, transposition, rating, tags and video link.
// The sheet is read from the page and handed to the view inside the browser
// (postMessage); nothing is fetched, saved or sent anywhere, since ChordWiki
// allows its lyrics to be shown on the site, not copied out of it.
// parse() comes from engine.js, inlined by scripts/build-userscript.mjs.

const VIEW = 'https://chord.nemut.ai';

// ---------------------------------------------------------------- read the page
// Rebuild the ChordPro source from the rendered sheet.
function readSheet() {
  const sheet = document.querySelector('.main div[oncopy]') || document.querySelector('.main');
  if (!sheet || !sheet.querySelector('span.chord')) return null;
  let text = '';
  const title = document.querySelector('h1.title');
  if (title && title.textContent.trim()) text += `{title:${title.textContent.trim()}}\n`;
  const sub = document.querySelector('.main h2.subtitle');
  if (sub && sub.textContent.trim()) text += `{subtitle:${sub.textContent.trim()}}\n`;
  for (const node of sheet.children) {
    if (node.tagName === 'BR') { text += '\n'; continue; }
    if (node.tagName !== 'P') continue;
    if (node.classList.contains('key')) {
      // "Key: D" or, when transposed, "Original Key: D / ... / Play: E"
      const t = node.textContent, m = t.match(/Play:\s*([A-G][#b]?m?)/) || t.match(/Key:\s*([A-G][#b]?m?)/);
      if (m) text += `{key:${m[1]}}\n`;
      continue;
    }
    if (node.classList.contains('comment')) { text += `{c:${node.textContent.trim()}}\n`; continue; }
    if (!node.classList.contains('line')) continue;
    for (const span of node.querySelectorAll('span')) {
      if (span.classList.contains('chord')) {
        const name = span.textContent.trim();
        if (name) text += `[${name}]`;
      } else if (span.classList.contains('word') || span.classList.contains('wordtop')) {
        text += span.textContent;
      }
    }
    text += '\n';
  }
  return text;
}

// ---------------------------------------------------------------- styles
// html.ncp-on: this view over the page; without it, ChordWiki's own page and a button back
const css = `
html.ncp-on, html.ncp-on body { height: 100%; margin: 0; overflow: hidden; background: #1b1d22; }
/* only ChordWiki's own parts are hidden; what other extensions add to the page stays visible */
html.ncp-on .ncp-page { display: none !important; }
html:not(.ncp-on) .ncp-root { display: none; }
html.ncp-on .ncp-back { display: none; }
.ncp-back { position: fixed; right: 14px; bottom: 14px; z-index: 2147483000; font: 700 12px "Yu Gothic UI", "Hiragino Sans", system-ui, sans-serif;
  color: #e6e8ec; background: #1b1d22; border: 1px solid #faa333; border-radius: 16px; padding: 6px 14px; cursor: pointer; box-shadow: 0 4px 14px #0006; }
.ncp-orig { font: inherit; color: #9db4d6; background: none; border: 0; padding: 0; cursor: pointer; }
.ncp-orig:hover { text-decoration: underline; }
.ncp-root { position: fixed; inset: 0; display: flex; flex-direction: column; background: #1b1d22; color: #e6e8ec;
  font: 12px "Yu Gothic UI", "Hiragino Sans", system-ui, sans-serif; z-index: 1000; }
.ncp-top { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; padding: 5px 10px; background: #16181c; border-bottom: 1px solid #3a3e46; }
.ncp-top a { color: #9db4d6; text-decoration: none; }
.ncp-top a:hover { text-decoration: underline; }
.ncp-logo { font-weight: 700; color: #e6e8ec !important; }
.ncp-nav { display: flex; flex-wrap: wrap; gap: 2px 9px; }
.ncp-sep { flex: 1; }
.ncp-top form { display: flex; align-items: center; gap: 5px; margin: 0; color: #8b9099; }
.ncp-top select { font: inherit; color: #e6e8ec; background: #1b1d22; border: 1px solid #3a3e46; border-radius: 5px; padding: 1px 4px; }
.ncp-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.ncp-tags a { padding: 1px 7px; border: 1px solid #3a3e46; border-radius: 9px; color: #c4cad4; }
.ncp-rate { color: #faa333 !important; }
.ncp-frame { flex: 1; border: 0; width: 100%; background: #1b1d22; }
`;

function el(tag, props = {}, kids = []) {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) e.append(k);
  return e;
}

// ---------------------------------------------------------------- page
function main() {
  const text = readSheet();
  if (!text || !parse(text, { mode: 'chordwiki' }).events.length) return;

  document.head.append(el('style', { textContent: css }));
  const top = el('div', { className: 'ncp-top' });

  // ChordWiki's menu (logo, ranking, search, history, edit, log, note, rating, random, chord book)
  top.append(el('a', { className: 'ncp-logo', href: '/', textContent: 'ChordWiki' }));
  const nav = el('div', { className: 'ncp-nav' });
  for (const a of document.querySelectorAll('#header ul.header a')) {
    const label = a.textContent.replace(/[[\]]/g, '').trim();
    if (!label || a.querySelector('img') || /beta\./.test(a.href)) continue;
    nav.append(el('a', { href: a.href, textContent: label, target: a.target || '' }));
  }
  top.append(nav);
  top.append(el('span', { className: 'ncp-sep' }));

  // transposition and ♯/♭ spelling: ChordWiki's own form (it reloads the page);
  // it goes back to its place on ChordWiki's own view
  const form = document.querySelector('#key form');
  const formHome = form && { parent: form.parentNode, next: form.nextSibling };
  const formSlot = el('span');
  top.append(formSlot);

  // rating, tags, video
  const rate = document.querySelector('#side .ratestar a');
  if (rate) {
    const v = rate.querySelector('[itemprop="ratingValue"]');
    top.append(el('a', { className: 'ncp-rate', href: rate.href, textContent: `★ ${v ? v.content : '評価'}` }));
  }
  const tags = [...document.querySelectorAll('#side .tag a[itemprop="keywords"]')];
  if (tags.length) top.append(el('div', { className: 'ncp-tags' }, tags.map((a) => el('a', { href: a.href, textContent: a.textContent.trim() }))));
  const video = document.querySelector('#side .movie a[href*="youtube.com"], #side .movie a[href*="youtu.be"], #side .movie a[href*="nicovideo"]');
  if (video) top.append(el('a', { href: video.href, target: '_blank', rel: 'noopener', textContent: '▶ 動画' }));

  // the editor's view, fed with this page's sheet
  const frame = el('iframe', { className: 'ncp-frame', src: VIEW + '/?embed=1', allow: 'midi; autoplay' });
  window.addEventListener('message', (e) => {
    if (e.origin !== VIEW || e.source !== frame.contentWindow || !e.data || e.data.type !== 'nemutai-ready') return;
    frame.contentWindow.postMessage({ type: 'nemutai-sheet', text }, VIEW);
  });

  // ChordWiki's own view, and back (remembered on this browser)
  const setOn = (on) => {
    document.documentElement.classList.toggle('ncp-on', on);
    if (form) { if (on) formSlot.append(form); else formHome.parent.insertBefore(form, formHome.next); }
    if (!on && frame.contentWindow) frame.contentWindow.postMessage({ type: 'nemutai-stop' }, VIEW);
    try { localStorage.setItem('ncp.off', on ? '0' : '1'); } catch {}
  };
  top.append(el('button', { className: 'ncp-orig', textContent: '元の表示', onclick: () => setOn(false) }));
  const back = el('button', { className: 'ncp-back', textContent: 'nemutaiで見る', onclick: () => setOn(true) });

  // ChordWiki's page as it is now, and ads it adds later; anything else added later is another extension's
  // (extensions that came first mostly use their own tags, like <grammarly-...>)
  for (const n of document.body.children) if (!n.tagName.includes('-')) n.classList.add('ncp-page');
  const isAd = (n) => /^(IFRAME|INS|SCRIPT)$/.test(n.tagName) || /google|ad[s_-]|aswift/i.test(n.id + ' ' + n.className);
  new MutationObserver((ms) => {
    for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && isAd(n)) n.classList.add('ncp-page');
  }).observe(document.body, { childList: true });
  document.body.append(el('div', { className: 'ncp-root' }, [top, frame]), back);
  let off = false;
  try { off = localStorage.getItem('ncp.off') === '1'; } catch {}
  setOn(!off);
}

main();
