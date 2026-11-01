// ChordWiki song pages: colour chords by degree, play the sheet along a
// timeline and light up the chord being played. Everything happens on the
// page; nothing is saved or sent anywhere (ChordWiki allows lyrics to be
// shown on the site, not copied out of it).
// Uses parse / K / lastEventAt / definingEvent from engine.js, inlined by
// scripts/build-userscript.mjs.

const PAL = ['#e05555', '#c27a66', '#e08a2e', '#b39a4d', '#c9a400', '#3fae57', '#4d9a90', '#3a86d9', '#6d7fbf', '#8d6ee0', '#a873ad', '#d9578f'];

// ---------------------------------------------------------------- read the page
// Rebuild the ChordPro source from the rendered sheet and remember which
// chord element each chord name came from.
function readSheet() {
  const sheet = document.querySelector('.main div[oncopy]') || document.querySelector('.main');
  if (!sheet || !sheet.querySelector('span.chord')) return null;
  let text = '';
  const els = new Map();   // offset of a chord name in text -> its element
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
        if (!name) continue;
        els.set(text.length + 1, span);
        text += `[${name}]`;
      } else if (span.classList.contains('word') || span.classList.contains('wordtop')) {
        text += span.textContent;
      }
    }
    text += '\n';
  }
  return { text, els };
}

// ---------------------------------------------------------------- styles
const css = `
.ncp-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483000; display: flex; gap: 8px; align-items: center;
  padding: 6px 10px; background: #1b1d22; color: #e6e8ec; font: 13px "Yu Gothic UI", system-ui, sans-serif; box-shadow: 0 -2px 10px #0006; }
.ncp-bar button, .ncp-bar input { font: inherit; color: #e6e8ec; background: #16181c; border: 1px solid #3a3e46; border-radius: 6px; padding: 3px 9px; }
.ncp-bar button.on { border-color: #faa333; color: #faa333; }
.ncp-bar input { width: 4.2em; }
.ncp-bar label { color: #8b9099; display: flex; gap: 4px; align-items: center; }
.ncp-bar .ncp-name { font-weight: 700; white-space: nowrap; }
.ncp-tl { flex: 1; min-width: 120px; height: 40px; overflow-x: auto; overflow-y: hidden; position: relative; background: #16181c; border-radius: 6px; }
.ncp-tl canvas { display: block; height: 40px; cursor: pointer; }
.ncp-ph { position: absolute; top: 0; width: 2px; height: 40px; background: #fff; pointer-events: none; }
span.chord.ncp-col { font-weight: 700; }
span.chord.ncp-cur { background: var(--ncp-c, #faa333); color: #fff !important; border-radius: 3px; }
body.ncp-on { padding-bottom: 60px; }
.ncp-view { position: fixed; left: 0; right: 0; top: 0; bottom: 52px; z-index: 2147482999; border: 0; width: 100%; height: calc(100% - 52px); background: #1b1d22; }
.ncp-bar.ncp-viewing > :not(.ncp-keep) { display: none; }
`;

// ---------------------------------------------------------------- player
// The same placement and voicing as the editor, played with a small WebAudio voice.
function createPlayer(S, ui) {
  const p = {
    on: false, pos: 0, ctx: null, master: null, t0: 0, b0: 0, next: 0, cycle: 0, voices: [], cur: [],
    bpm: () => +ui.bpm.value || 120,
    loop: () => ui.loop.classList.contains('on'),
    rhythm: () => ui.rhythm.classList.contains('on'),
    beatAt(t) { return this.b0 + (t - this.t0) * this.bpm() / 60; },
    timeAt(b) { return this.t0 + (b - this.b0) * 60 / this.bpm(); },
    audio() {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain(); this.master.gain.value = 0.18;
        const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
        this.master.connect(lp).connect(this.ctx.destination);
      }
      return this.ctx;
    },
    noteOn(n, vel, time) {
      const c = this.ctx, f = 440 * 2 ** ((n - 69) / 12), g = c.createGain(), a = vel / 127;
      const o1 = c.createOscillator(), o2 = c.createOscillator(), g2 = c.createGain();
      o1.type = 'triangle'; o2.type = 'sine'; o1.frequency.value = f; o2.frequency.value = f * 2; g2.gain.value = 0.25;
      o1.connect(g); o2.connect(g2).connect(g); g.connect(this.master);
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(a, time + 0.006);
      g.gain.setTargetAtTime(a * 0.35, time + 0.01, 0.25);
      o1.start(time); o2.start(time);
      return { g, o: [o1, o2], start: time };
    },
    release(time) {
      for (const v of this.voices) {
        // released before it starts (stopped right after scheduling): never sound it
        if (time <= v.start + 0.001) { v.g.gain.cancelScheduledValues(0); v.g.gain.setValueAtTime(0, Math.min(time, v.start)); for (const o of v.o) o.stop(v.start); continue; }
        v.g.gain.cancelScheduledValues(time); v.g.gain.setTargetAtTime(0, time, 0.08); for (const o of v.o) o.stop(time + 0.6);
      }
      this.voices = [];
    },
    strike(notes, vel, time) { this.release(time); this.voices = notes.map((n) => this.noteOn(n, vel, time)); },
    apply(e, time) {
      const vel = this.rhythm() && e.acc ? 127 : 100;
      if (e.kind === K.PLAY || e.kind === K.STOP || e.kind === K.ERR) { this.cur = e.kind === K.PLAY ? e.chord.notes : []; this.strike(this.cur, vel, time); }
      else if ((e.kind === K.STREAK || (e.kind === K.HIT && this.rhythm())) && this.cur.length) this.strike(this.cur, vel, time);
    },
    start() {
      if (!S.events.length || S.total <= 0) return;
      const c = this.audio(); c.resume();
      this.on = true; ui.play.textContent = '停止'; ui.play.classList.add('on');
      this.t0 = c.currentTime + 0.05; this.b0 = this.pos;
      this.resync();
      this.timer = setInterval(() => this.tick(), 25);
      requestAnimationFrame(() => this.frame());
    },
    stop() {
      this.on = false; clearInterval(this.timer);
      if (this.ctx) this.release(this.ctx.currentTime);
      ui.play.textContent = '再生'; ui.play.classList.remove('on');
      ui.mark(null);
    },
    resync() {
      const c = this.ctx, now = Math.max(c.currentTime + 0.02, this.t0);
      let b = this.beatAt(now);
      if (b >= S.total) { if (!this.loop()) return this.stop(); b %= S.total; }
      this.b0 = b; this.t0 = now; this.cycle = 0;
      const i = lastEventAt(S.events, b), d = definingEvent(S.events, i, this.loop());
      this.cur = d >= 0 && S.events[d].kind === K.PLAY ? S.events[d].chord.notes : [];
      this.strike(this.cur, 100, now);
      this.next = i + 1;
    },
    tick() {
      const c = this.ctx, until = c.currentTime + 0.12;
      for (let guard = 0; guard < 512; guard++) {
        if (this.next >= S.events.length) {
          const endT = this.timeAt(S.total * (this.cycle + 1));
          if (endT > until) break;
          if (!this.loop()) { this.release(endT); clearInterval(this.timer); setTimeout(() => this.stop(), Math.max(0, (endT - c.currentTime) * 1000)); return; }
          this.cycle++; this.next = 0;
        }
        const e = S.events[this.next], time = this.timeAt(e.t + this.cycle * S.total);
        if (time > until) break;
        this.apply(e, Math.max(time, c.currentTime));
        this.next++;
      }
    },
    seek(b) {
      this.pos = Math.max(0, Math.min(b, S.total));
      if (this.on) { this.t0 = this.ctx.currentTime + 0.03; this.b0 = this.pos; this.resync(); }
      ui.playhead(this.pos);
    },
    frame() {
      if (!this.on) return;
      let b = Math.max(this.b0, this.beatAt(this.ctx.currentTime));
      b = b % S.total;
      this.pos = b;
      ui.playhead(b);
      const i = lastEventAt(S.events, b);
      ui.mark(i >= 0 ? S.events[i].tok : null);
      requestAnimationFrame(() => this.frame());
    },
  };
  return p;
}

// ---------------------------------------------------------------- page UI
function main() {
  const sheet = readSheet();
  if (!sheet) return;
  const S = parse(sheet.text, { mode: 'chordwiki' });
  if (!S.events.length) return;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // chords coloured by degree from the key (or the first chord)
  const elOf = (tok) => sheet.els.get(tok.o0);
  const colorOf = (tok) => (tok && tok.chord ? PAL[(tok.chord.rpc - S.tonic + 12) % 12] : null);
  for (const tok of S.tokens) {
    const el = elOf(tok), c = colorOf(tok);
    if (el && c) { el.classList.add('ncp-col'); el.style.color = c; el.style.setProperty('--ncp-c', c); }
  }

  const bar = document.createElement('div');
  bar.className = 'ncp-bar';
  bar.innerHTML = `<span class="ncp-name ncp-keep">♪</span><button data-k="view" class="ncp-keep" title="nemutai Chord Editor の画面で開く">nemutai</button><button data-k="play">再生</button><button data-k="loop" class="on">ループ</button>` +
    `<button data-k="rhythm" class="on" title="書いた長さどおりに弾き直す">リズム</button><label>BPM <input data-k="bpm" type="number" min="20" max="400"></label>` +
    `<div class="ncp-tl"><canvas></canvas><div class="ncp-ph"></div></div>`;
  document.body.appendChild(bar);
  document.body.classList.add('ncp-on');
  const q = (k) => bar.querySelector(`[data-k="${k}"]`);
  const tl = bar.querySelector('.ncp-tl'), cv = tl.querySelector('canvas'), ph = tl.querySelector('.ncp-ph');
  const pxq = 14;
  let curEl = null;
  const ui = {
    play: q('play'), loop: q('loop'), rhythm: q('rhythm'), bpm: q('bpm'),
    playhead(b) {
      const x = 8 + b * pxq;
      ph.style.left = x + 'px';
      if (x < tl.scrollLeft + 20 || x > tl.scrollLeft + tl.clientWidth - 40) tl.scrollLeft = x - tl.clientWidth / 3;
    },
    // light the playing chord on the sheet and keep it in view
    mark(tok) {
      const el = tok ? elOf(tok) : null;
      if (el === curEl) return;
      if (curEl) curEl.classList.remove('ncp-cur');
      curEl = el;
      if (!el) return;
      el.classList.add('ncp-cur');
      const r = el.getBoundingClientRect(), h = window.innerHeight - 60;
      if (r.top < h * 0.15 || r.bottom > h * 0.75) window.scrollTo({ top: window.scrollY + r.top - h * 0.35, behavior: 'smooth' });
    },
  };
  ui.bpm.value = S.legend.bpm || 120;
  const player = createPlayer(S, ui);
  ui.play.onclick = () => (player.on ? player.stop() : player.start());
  for (const k of ['loop', 'rhythm']) q(k).onclick = () => q(k).classList.toggle('on');
  ui.bpm.oninput = () => { if (player.on) { player.t0 = player.ctx.currentTime; player.b0 = player.pos; } };

  // timeline: chord blocks as long as they sound
  const w = Math.ceil(S.total * pxq) + 16, dpr = window.devicePixelRatio || 1;
  cv.width = Math.min(w, 30000) * dpr; cv.height = 40 * dpr; cv.style.width = Math.min(w, 30000) + 'px';
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  const X = (b) => 8 + b * pxq;
  g.fillStyle = '#3a3e46';
  for (const b of S.barLines) g.fillRect(X(b), 0, 1, 40);
  const ev = S.events, sounding = [K.PLAY, K.STOP, K.ERR];
  g.font = 'bold 10px sans-serif';
  for (let i = 0; i < ev.length; i++) {
    if (!sounding.includes(ev[i].kind)) continue;
    let j = i + 1;
    while (j < ev.length && !sounding.includes(ev[j].kind)) j++;
    const x0 = X(ev[i].t), x1 = X(j < ev.length ? ev[j].t : S.total), c = colorOf(ev[i].tok);
    g.fillStyle = c ? c + '66' : '#2a2d33'; g.fillRect(x0 + 1, 6, x1 - x0 - 2, 28);
    g.fillStyle = c || '#8b9099'; g.fillRect(x0 + 1, 6, 2, 28);
    g.save(); g.beginPath(); g.rect(x0, 6, x1 - x0 - 2, 28); g.clip();
    g.fillStyle = '#e6e8ec'; g.fillText(sheet.text.slice(ev[i].tok.o0, ev[i].tok.o1), x0 + 5, 24); g.restore();
  }
  for (const wn of S.warnings) { g.strokeStyle = '#f26161'; g.lineWidth = 2; g.strokeRect(X(wn.start) + 1, 5, (Math.max(wn.written, wn.meter)) * pxq - 2, 30); }
  cv.onclick = (e) => player.seek(Math.max(0, (e.offsetX - 8) / pxq));
  ui.playhead(0);

  // the chord.nemut.ai screen over the page; the sheet goes to it inside the
  // browser (postMessage) and the embedded view keeps nothing
  const VIEW = 'https://chord.nemut.ai';
  let frame = null;
  const setView = (on) => {
    try { localStorage.setItem('ncp.view', on ? '1' : '0'); } catch {}
    q('view').classList.toggle('on', on);
    bar.classList.toggle('ncp-viewing', on);
    if (on) {
      if (player.on) player.stop();
      frame = document.createElement('iframe');
      frame.className = 'ncp-view';
      frame.allow = 'midi; autoplay';
      frame.src = VIEW + '/?embed=1';
      document.body.appendChild(frame);
    } else if (frame) { frame.remove(); frame = null; }
  };
  window.addEventListener('message', (e) => {
    if (e.origin !== VIEW || !frame || e.source !== frame.contentWindow || !e.data || e.data.type !== 'nemutai-ready') return;
    frame.contentWindow.postMessage({ type: 'nemutai-sheet', text: sheet.text }, VIEW);
  });
  q('view').onclick = () => setView(!frame);
  let saved = null;
  try { saved = localStorage.getItem('ncp.view'); } catch {}
  if (saved === '1') setView(true);

  // Alt+click a chord on the sheet: play from there
  sheet.els.forEach((el, o0) => {
    el.addEventListener('click', (e) => {
      if (!e.altKey) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const tok = S.tokens.find((t) => t.o0 === o0), first = S.events.find((x) => x.tok === tok);
      if (first) { player.pos = first.t; if (player.on) player.seek(first.t); else player.start(); }
    }, true);
  });
}

main();
