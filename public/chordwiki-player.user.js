// ==UserScript==
// @name         nemutai Chord Player for ChordWiki
// @namespace    https://chord.nemut.ai/
// @version      0.1.0
// @description  Plays ChordWiki chord sheets along a timeline, with chords coloured by degree.
// @description:ja ChordWiki のコード譜をタイムラインに合わせて鳴らし、コードを度数で色分けします。
// @match        https://ja.chordwiki.org/wiki/*
// @match        https://ja.chordwiki.org/wiki.cgi?*
// @grant        none
// @license      MIT
// @homepageURL  https://chord.nemut.ai/
// @downloadURL  https://chord.nemut.ai/chordwiki-player.user.js
// @updateURL    https://chord.nemut.ai/chordwiki-player.user.js
// ==/UserScript==

(() => {
'use strict';
// Chord sheet engine for the web editor. Same rules as Rechord_MIDI_Player.jsfx
// (rechord voicing and placement, ChordWiki bars / lengths / legend); the test
// in test/web_vs_jsfx.mjs checks both produce the same notes.

const K = { STOP: 0, PLAY: 1, HOLD: 2, STREAK: 3, ERR: 4, HIT: 5 };
const ROW = { BARS: 0, TEXT: 1, BLANK: 2, LABEL: 3 };
const OFF13 = [0, 4, 7, 10, 14, 17, 21];
const MAJ = '\x01', HDIM = '\x02';

// ------------------------------------------------------------------ text
// Full-width ASCII, sharps/flats and the maj / half-dim symbols are folded to
// single characters, as rechord does. opos maps back to the original text.
function normalize(raw) {
  let n = '', opos = [];
  let i = raw.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < raw.length) {
    const c = raw[i], u = raw.charCodeAt(i);
    opos.push(i);
    if (c === '\r') { n += '\n'; i += raw[i + 1] === '\n' ? 2 : 1; continue; }
    if (c === '\t') n += ' ';
    else if (u >= 0xff01 && u <= 0xff5e) n += String.fromCharCode(u - 0xff01 + 0x21);
    else if (u === 0x3000) n += ' ';
    else if (c === '♯') n += '#';
    else if (c === '♭') n += 'b';
    else if (c === '△' || c === 'Δ') n += MAJ;
    else if (c === 'Φ' || c === 'φ' || c === 'ø') n += HDIM;
    else n += c;
    i += 1;
  }
  opos.push(raw.length);
  return { n, opos };
}

// ------------------------------------------------------------------ chords
const isDigit = (c) => c >= '0' && c <= '9';
const isRoot = (c) => c >= 'A' && c <= 'G';
const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const typeCharOk = (c) => c === 'M' || (c >= 'a' && c <= 'z') || isDigit(c) ||
  '(),-+#'.includes(c) || c === MAJ || c === HDIM;

// chord-translator's translateType(): offsets from the 13th chord, null = absent
function translateType(ty) {
  const TN = [0, 0, 0, null, null, null, null];
  const at = (pos, pat) => pos >= 0 && ty.startsWith(pat, pos);
  const ch = (pos) => (pos >= 0 && pos < ty.length ? ty[pos] : '');
  const cut = (pos, len) => { ty = ty.slice(0, pos) + ty.slice(pos + len); };
  const rm = (a) => { const p = ty.indexOf(a); if (p >= 0) cut(p, a.length); return p >= 0; };
  const rm2 = (a, b) => {
    const p = ty.indexOf(a), q = ty.indexOf(b);
    const r = p >= 0 && (q < 0 || p <= q) ? p : q;
    if (r >= 0) cut(r, r === p ? a.length : b.length);
    return r >= 0;
  };
  const rmStart = (pat) => { if (at(0, pat)) { cut(0, pat.length); return true; } return false; };
  const rmMajor = (num) => {
    for (let i = 0; i < ty.length; i++) {
      if ((ty[i] === 'M' || ty[i] === MAJ) && at(i + 1, num)) { cut(i, 1 + num.length); return true; }
      if ((at(i, 'Maj') || at(i, 'maj')) && at(i + 3, num)) { cut(i, 3 + num.length); return true; }
    }
    return false;
  };
  const dec = (k) => { TN[k] = (TN[k] === null ? 0 : TN[k]) - 1; };

  // omit: /[(]?(omit|no)(\d+)[)]?/
  let om = -1, p = -1, d0 = 0;
  for (let i = 0; p < 0 && i < ty.length; i++) {
    if (at(i, 'omit') && isDigit(ch(i + 4))) { p = i; d0 = i + 4; }
    else if (at(i, 'no') && isDigit(ch(i + 2))) { p = i; d0 = i + 2; }
  }
  if (p >= 0) {
    let d1 = d0; om = 0;
    while (isDigit(ch(d1))) { om = om * 10 + +ch(d1); d1++; }
    if (d1 - d0 > 2) om = -1;
    if (ch(d1) === ')') d1++;
    if (p > 0 && ch(p - 1) === '(') p--;
    cut(p, d1 - p);
  }
  // tension: /\((.+)\)/
  let tens = '';
  p = ty.indexOf('(');
  if (p >= 0) {
    let close = -1;
    for (let i = ty.length - 1; close < 0 && i > p + 1; i--) if (ty[i] === ')') close = i;
    if (close > p + 1) {
      for (let i = p + 1; i < close; i++) if (ty[i] !== ',' && ty[i] !== ' ') tens += ty[i];
      cut(p, close - p + 1);
    } else p = -1;
  }
  const hasTens = p >= 0;
  // base
  if (ch(0) === 'M' && !(at(1, '7') || at(1, '9') || at(1, '11') || at(1, '13') || at(1, 'aj'))) cut(0, 1);
  else if (ch(0) === 'm' && !at(1, 'aj')) { cut(0, 1); TN[1] = -1; }
  // aug / half-diminished
  const pa = ty.indexOf('aug');
  let pp = -1;
  for (let i = 0; pp < 0 && i < ty.length; i++) if (ty[i] === '+' && !isDigit(ch(i + 1))) pp = i;
  if (pa >= 0 || pp >= 0) {
    if (pa >= 0 && (pp < 0 || pa < pp)) cut(pa, ch(pa + 3) === '5' ? 4 : 3); else cut(pp, 1);
    TN[2] = 1;
  } else {
    const ph = ty.indexOf(HDIM);
    if (ph >= 0) { cut(ph, 1); TN[1] = -1; TN[2] = -1; TN[3] = 0; }
  }
  // fifth
  if (rm2('+5', '#5')) TN[2] = 1; else if (rm2('-5', 'b5')) TN[2] = -1;
  // 5 6 7 9 11 13 at the start
  if (rmStart('5')) TN[1] = null;
  else if (rmStart('6')) TN[3] = -1;
  else if (rmStart('7')) TN[3] = 0;
  else if (rmStart('9')) { TN[3] = 0; TN[4] = 0; }
  else if (rmStart('11')) { TN[3] = 0; TN[4] = 0; TN[5] = 0; }
  else if (rmStart('13')) { TN[3] = 0; TN[4] = 0; TN[5] = 0; TN[6] = 0; }
  // sus
  if (rm('sus4')) TN[1] = 1; else if (rm('sus2')) TN[1] = -2;
  // add
  if (rm('add2')) TN[4] = -12;
  else if (rm('add9')) TN[4] = 0;
  else if (rm('add4')) TN[5] = -12;
  else if (rm('add11')) TN[5] = 0;
  else if (rm('add6')) TN[6] = -12;
  else if (rm('add13')) TN[6] = 0;
  // major 7th family
  if (rmMajor('7')) TN[3] = 1;
  else if (rmMajor('9')) { TN[3] = 1; TN[4] = 0; }
  else if (rmMajor('11')) { TN[3] = 1; TN[4] = 0; TN[5] = 0; }
  else if (rmMajor('13')) { TN[3] = 1; TN[4] = 0; TN[5] = 0; TN[6] = 0; }
  // dim
  if (rmStart('dim7') || rmStart('o7')) { dec(1); dec(2); TN[3] = -1; }
  else if (rmStart('dim') || rmStart('o')) { dec(1); dec(2); }
  // tensions
  if (hasTens) ty += tens;
  if (rm2('+5', '#5')) TN[2] = 1;
  if (rm2('-5', 'b5')) TN[2] = -1;
  if (rm('M7')) TN[3] = 1;
  if (rm('7')) TN[3] = 0;
  if (rm2('+9', '#9')) TN[4] = 1;
  if (rm2('-9', 'b9')) TN[4] = -1;
  if (rm('9')) TN[4] = 0;
  if (rm2('+11', '#11')) TN[5] = 1;
  if (rm2('-11', 'b11')) TN[5] = -1;
  if (rm('11')) TN[5] = 0;
  if (rm2('+13', '#13')) TN[6] = 1;
  if (rm2('-13', 'b13')) TN[6] = -1;
  if (rm('13')) TN[6] = 0;
  // omit
  const omk = { 1: 0, 3: 1, 5: 2, 7: 3, 9: 4, 11: 5, 13: 6 }[om];
  if (omk !== undefined) TN[omk] = null;

  return ty.length === 0 && TN.filter((x) => x !== null).length >= 2 ? TN : null;
}

// N[t0..t1) as a chord: { notes, rpc } or null
function parseChord(N, t0, t1, octave = 3, transpose = 0) {
  const c = N[t0];
  if (!isRoot(c)) return null;
  let i = t0 + 1, acc = 0, sh = 0, fl = 0;
  while (i < t1 && i < t0 + 3 && (N[i] === '#' || N[i] === 'b')) {
    if (N[i] === '#') { acc++; sh = 1; } else { acc--; fl = 1; }
    i++;
  }
  const rend = i, ts = i;
  let ok = !(sh && fl) && !(i < t1 && (N[i] === '#' || N[i] === 'b'));
  while (ok && i < t1 && N[i] !== '/' && !(N[i] === 'o' && i + 1 < t1 && N[i + 1] === 'n')) {
    if (typeCharOk(N[i])) i++; else ok = false;
  }
  const te = i;
  let d0 = -1, dacc = 0, dsh = 0, dfl = 0, dend = 0;
  if (ok && i < t1) {
    i += N[i] === '/' ? 1 : 2;
    if (i < t1 && isRoot(N[i])) {
      d0 = i; i++;
      while (i < t1 && i < d0 + 3 && (N[i] === '#' || N[i] === 'b')) {
        if (N[i] === '#') { dacc++; dsh = 1; } else { dacc--; dfl = 1; }
        i++;
      }
      dend = i;
      if (i !== t1) ok = false;
    } else ok = false;
  }
  const TN = ok ? translateType(N.slice(ts, te)) : null;
  if (!TN) return null;
  const base = 12 * (octave + 1) + LETTER[c] + acc;
  const NL = [];
  for (let k = 0; k < 7; k++) if (TN[k] !== null) NL.push(base + OFF13[k] + TN[k]);
  // fewer than five notes: double from the third note down (rechord fixNotes)
  for (let k = NL.length - 3; k < 2; k++) if (k >= 0) NL.push(NL[k] + 12);
  // on-chord: bass below the chord unless it names the root itself
  if (d0 >= 0 && !(dsh && dfl) && N.slice(d0, dend) !== N.slice(t0, rend)) {
    let bm = 12 * (octave + 1) + LETTER[N[d0]] + dacc;
    if (NL[0] <= bm) bm -= 12;
    NL.unshift(bm);
  }
  return {
    notes: NL.map((x) => Math.max(0, Math.min(127, x + transpose))),
    rpc: (LETTER[c] + acc + 24) % 12,
  };
}

// a chord name on its own, e.g. "Am7" or "C/E"
function chordFromName(name, transpose = 0, octave = 3) {
  const { n } = normalize(name.trim());
  return n ? parseChord(n, 0, n.length, octave, transpose) : null;
}

// rechord setBeatPositions(): slots for n chords in a bar of MB beats of MU quarters
function beatPositions(n, MB, MU) {
  const pos = [];
  if (n === 1) pos.push(0);
  else if (MB / n >= 2) {
    const timing = Math.floor(MB / n);
    for (let i = 0; i < MB; i++) if (i % timing === 0) pos.push(i * MU);
  } else if (n > MB && n <= MB * 2) {
    for (let i = 0; i < MB; i++) pos.push(i * MU, (i + 0.5) * MU);
  } else if (n > MB * 2) {
    for (let i = 0; i < MB; i++) for (let j = 0; j < 4; j++) pos.push((i + j * 0.25) * MU);
  } else {
    for (let i = 0; i < MB; i++) pos.push(i * MU);
  }
  return pos;
}

// ------------------------------------------------------------------ score
// opts: { mode: 'auto'|'rechord'|'chordwiki', beatsPerBar: 0 (= song / project),
//         projectTs: [4, 4], octave: 3, transpose: 0 }
function parse(raw, opts = {}) {
  const o = { mode: 'auto', beatsPerBar: 0, projectTs: [4, 4], octave: 3, transpose: 0, ...opts };
  const { n: N, opos: OPOS } = normalize(raw);
  const S = {
    rows: [], tokens: [], events: [], bars: [], warnings: [], barLines: [],
    legend: { bpm: 0, ts: null, key: null, minor: false, swing8: false, swing16: false },
    mode: o.mode === 'rechord' ? 'rechord' : o.mode === 'chordwiki' ? 'chordwiki' : detectChordwiki(N) ? 'chordwiki' : 'rechord',
    total: 0, MB: 4, MU: 1, tonic: 0,
  };
  const ms = defaultSymbols();
  if (S.mode === 'chordwiki') readLegend(N, S.legend, ms);
  if (o.beatsPerBar > 0) { S.MB = o.beatsPerBar; S.MU = 1; }
  else if (S.legend.ts) { S.MB = S.legend.ts[0]; S.MU = 4 / S.legend.ts[1]; }
  else { S.MB = Math.floor(o.projectTs[0]) || 4; S.MU = 4 / (o.projectTs[1] || 4); }

  const ctx = { N, OPOS, S, o, ms, line: 0 };
  if (S.mode === 'rechord') parseRechord(ctx); else parseChordwiki(ctx);

  const L = S.legend;
  S.tonic = L.key !== null ? (L.key + (L.minor ? 3 : 0)) % 12 : -1;
  if (S.tonic < 0) { const t = S.tokens.find((t) => t.chord); S.tonic = t ? t.chord.rpc : 0; }
  return S;
}

function detectChordwiki(N) {
  let ls = true;
  for (let i = 0; i < N.length; i++) {
    if (N[i] === '[' && i + 1 < N.length && (isRoot(N[i + 1]) || N[i + 1] === '|')) return true;
    if (ls && N[i] === '{') return true;
    ls = N[i] === '\n';
  }
  return false;
}

function addRow(S, kind, o0 = 0, o1 = 0) {
  const r = { kind, o0, o1, bars: [], ly0: -1, ly1: -1, barred: false, hasLy: false, pre: -1, line: -1 };
  S.rows.push(r);
  return r;
}
const lastRow = (S) => S.rows[S.rows.length - 1];
function addBar(S, len) {
  const r = lastRow(S);
  const b = { tokens: [], len, cont: false, start: 0, written: null, row: S.rows.length - 1 };
  r.bars.push(b); S.bars.push(b);
  return b;
}
function addTok(ctx, n0, n1, kind) {
  const { S, OPOS } = ctx;
  const b = S.bars[S.bars.length - 1];
  const t = { i: S.tokens.length, o0: OPOS[n0], o1: OPOS[n1], kind, t: -1, ly0: -1, ly1: -1, chord: null, hits: [], bar: b };
  S.tokens.push(t); b.tokens.push(t);
  return t;
}
function addEvent(S, t, kind, chord, tok, acc = 0, hit = null) {
  const e = { t, kind, chord, tok, acc, hit };
  S.events.push(e);
  return e;
}

// --- Rechord
function parseRechord(ctx) {
  const { N, OPOS, S } = ctx;
  const st = { bar: 0, ended: false, rowLine: -1 };
  const barLen = S.MB * S.MU;
  let pos = 0;
  while (pos < N.length) {
    const ls = pos;
    let le = ls;
    while (le < N.length && N[le] !== '\n') le++;
    pos = le + 1;
    ctx.line++;
    let p = ls;
    while (p < le && N[p] === ' ') p++;
    if (p >= le) addRow(S, ROW.BLANK);
    else if (N[ls] === '#') addRow(S, ROW.TEXT, OPOS[ls], OPOS[le]);
    else if (N[p] === '<' || N[p] === '>') {
      addRow(S, ROW.TEXT, OPOS[ls], OPOS[le]);
      if (!st.ended) {
        if (N[p] === '<') { st.bar = 0; S.events.length = 0; S.barLines.length = 0; } else { S.total = st.bar * barLen; st.ended = true; }
      }
    } else {
      let s = ls;
      while (s <= le) {
        let e = s;
        while (e < le && N[e] !== '|' && N[e] !== 'l') e++;
        rcBar(ctx, st, s, e, barLen);
        s = e + 1;
      }
    }
  }
  if (!st.ended) S.total = st.bar * barLen;
}

function rcBar(ctx, st, s, e, barLen) {
  const { N, S, o } = ctx;
  const t0s = [], t1s = [];
  const open = () => t0s.length > 0 && t1s[t1s.length - 1] < 0;
  const close = (at) => { if (open()) t1s[t1s.length - 1] = at; };
  const start = (at) => { t0s.push(at); t1s.push(-1); };
  let i = s;
  while (i < e) {
    const c = N[i];
    if (c === ' ') { i++; close(i - 1); }
    else if (c === 'N' && i + 4 <= e && N.startsWith('N.C.', i)) { close(i); start(i); i += 4; }
    else if (isRoot(c) && !(i > s && N[i - 1] === '/') && !(i > s + 1 && N[i - 2] === 'o' && N[i - 1] === 'n')) {
      close(i); start(i); i++;
      if (i < e && (N[i] === '#' || N[i] === 'b')) i++;
      if (i < e && (N[i] === '#' || N[i] === 'b')) i++;
    } else if ('%=_<>'.includes(c)) { close(i); start(i); i++; }
    else { if (!open()) start(i); i++; }
    if (t0s.length >= 1000) i = e;
  }
  close(e);
  const nt = t0s.length;
  if (!nt) return;
  const r = lastRow(S);
  if (!r || r.kind !== ROW.BARS || st.rowLine !== ctx.line) { addRow(S, ROW.BARS); st.rowLine = ctx.line; }
  const bar = addBar(S, barLen);
  bar.start = st.bar * barLen;
  bar.closed = true;
  if (!st.ended) S.barLines.push(st.bar * barLen);
  const f0 = t0s[0], f1 = t1s[0];
  if (f1 - f0 === 1 && (N[f0] === '<' || N[f0] === '>')) {
    for (let k = 0; k < nt; k++) addTok(ctx, t0s[k], t1s[k], K.ERR);
    if (!st.ended) {
      if (N[f0] === '<') { st.bar = 0; S.events.length = 0; S.barLines.length = 0; } else { S.barLines.pop(); S.total = st.bar * barLen; st.ended = true; }
    }
    return;
  }
  const pos = beatPositions(nt, S.MB, S.MU);
  for (let k = 0; k < nt; k++) {
    const a = t0s[k], b = t1s[k], len = b - a, c = N[a];
    let kind, chord = null;
    if (len === 1 && c === '%') kind = K.STREAK;
    else if (len === 1 && c === '=') kind = K.HOLD;
    else if (len === 1 && c === '_') kind = K.STOP;
    else if (len === 4 && N.startsWith('N.C.', a)) kind = K.STOP;
    else { chord = parseChord(N, a, b, o.octave, o.transpose); kind = chord ? K.PLAY : K.ERR; }
    const tok = addTok(ctx, a, b, kind);
    tok.chord = chord;
    if (k < pos.length) {
      tok.t = pos[k];
      if (!st.ended) addEvent(S, st.bar * barLen + pos[k], kind, chord, tok);
    }
  }
  if (!st.ended) st.bar++;
}

// --- ChordWiki: length symbols and the legend
function defaultSymbols() {
  return [
    { sym: '-', q: 0.5, acc: false },
    { sym: '=', q: 0.25, acc: false },
    { sym: '>', q: 0.5, acc: true },
  ];
}
function setSymbol(ms, sym, q, acc) {
  let m = ms.find((x) => x.sym === sym);
  if (!m) { m = { sym }; ms.push(m); }
  m.q = q; m.acc = acc;
  return m;
}
const symAt = (ms, N, j) => ms.find((m) => N.startsWith(m.sym, j)) || null;

function numAt(N, j) {
  let v = 0, e = j;
  while (e < N.length && isDigit(N[e])) { v = v * 10 + +N[e]; e++; }
  if (e < N.length && N[e] === '.') {
    e++;
    let k = 0.1;
    while (e < N.length && isDigit(N[e])) { v += +N[e] * k; k *= 0.1; e++; }
  }
  return [v, e];
}

// {c:} legend ("X：N分音符", "X：N分音符アクセント", "X：アクセント", "(shuffle)",
// "BPM=106", "4/4拍子") and {key:}
function readLegend(N, L, ms) {
  let firstQ = 0, accOnly = null;
  for (let i = 0; i < N.length;) {
    const ls = i;
    let le = ls;
    while (le < N.length && N[le] !== '\n') le++;
    i = le + 1;
    let j = ls;
    while (j < le && N[j] === ' ') j++;
    if (j < le && N.startsWith('{key:', j)) {
      let k = j + 5;
      while (k < le && N[k] === ' ') k++;
      if (isRoot(N[k])) {
        let pc = LETTER[N[k]]; k++;
        if (N[k] === '#') { pc++; k++; } else if (N[k] === 'b') { pc--; k++; }
        L.key = (pc + 12) % 12;
        L.minor = N[k] === 'm' && !N.startsWith('maj', k);
      }
    }
    if (!(j < le && (N.startsWith('{c:', j) || N.startsWith('{comment:', j) || N.startsWith('{ci:', j)))) continue;
    for (let q = j; q < le; q++) {
      if (N[q] === ':' && q > j + 3) {
        let st = q - 1;
        if (st > j && N.charCodeAt(st) >= 0xdc00 && N.charCodeAt(st) <= 0xdfff) st--;   // surrogate pair
        const sym = N.slice(st, q);
        let k = q + 1;
        while (k < le && N[k] === ' ') k++;
        if (isDigit(N[k]) && sym !== ' ') {
          const [v, e0] = numAt(N, k);
          if (N.startsWith('分音符', e0) && v > 0) {
            const e = e0 + 3;
            const acc = N.startsWith('アクセント', e) || N.startsWith('(アクセント)', e);
            setSymbol(ms, sym, 4 / v, acc);
            if (!acc && firstQ === 0) firstQ = 4 / v;
            if (N.startsWith('(shuffle)', e) || N.startsWith('(シャッフル)', e) || N.startsWith('shuffle', e)) {
              if (v === 8) L.swing8 = true; else if (v === 16) L.swing16 = true;
            }
          }
        } else if (N.startsWith('アクセント', k) && sym !== ' ') {
          accOnly = setSymbol(ms, sym, 0.5, true);
        }
      }
      if (N.startsWith('BPM', q)) {
        let k = q + 3;
        while (k < le && ' =:'.includes(N[k])) k++;
        if (isDigit(N[k])) L.bpm = numAt(N, k)[0];
      }
      if (isDigit(N[q]) && (q === j || !isDigit(N[q - 1]))) {
        const [a, e] = numAt(N, q);
        if (N[e] === '/' && isDigit(N[e + 1])) {
          const [b, e2] = numAt(N, e + 1);
          if (N.startsWith('拍子', e2) && a > 0 && b > 0) L.ts = [a, b];
        }
      }
    }
  }
  if (accOnly && firstQ > 0) accOnly.q = firstQ;
}

// --- ChordWiki parser
function parseChordwiki(ctx) {
  const { N, OPOS, S, o, ms } = ctx;
  const W = {
    slots: [], barN: 0, barSlash: false, lineBarred: false, rowLine: -1, lastTok: null,
    repEv: 0, repT: 0, runQ: 0, symEnd: -1,
  };
  const L = S.legend;
  const swing = (t) => {
    if (L.swing16) { const f = t - Math.floor(t * 2 + 1e-6) / 2; if (Math.abs(f - 0.25) < 1e-4) t += 1 / 12; }
    if (L.swing8) { const f = t - Math.floor(t + 1e-6); if (Math.abs(f - 0.5) < 1e-4) t += 1 / 6; }
    return t;
  };
  const emit = (sl, t) => {
    const tok = sl.tok;
    tok.t = t;
    const e0 = addEvent(S, W.barN + swing(t), tok.kind, sl.chord, tok);
    for (const h of sl.hits) {
      if (h.off === 0) {
        e0.acc = h.acc; e0.hit = h.dh;
        if (e0.kind === K.HOLD) e0.kind = K.HIT;
      } else addEvent(S, W.barN + swing(t + h.off), K.HIT, null, tok, h.acc, h.dh);
    }
  };
  // closed: the bar ends at a written barline (shown as a closing line)
  const finishBar = (closed = false) => {
    const sl = W.slots;
    if (sl.length) {
      const MBU = S.MB * S.MU;
      let known = 0, unknown = 0;
      for (const s of sl) if (s.expl) known += s.dur; else unknown++;
      let t = 0, len;
      const bar = S.bars[S.bars.length - 1];
      if (W.barSlash) {
        for (const s of sl) { emit(s, t); t += s.expl ? s.dur : s.beats * S.MU; }
        len = Math.max(MBU, t);
      } else if (known === 0) {
        const pos = beatPositions(sl.length, S.MB, S.MU);
        sl.forEach((s, k) => { if (k < pos.length) emit(s, pos[k]); });
        len = MBU; t = null;
      } else {
        const missing = unknown > 0 ? Math.max(0, MBU - known) / unknown : 0;
        for (const s of sl) { emit(s, t); t += s.expl ? s.dur : missing; }
        len = Math.max(MBU, t);
      }
      bar.len = len;
      // closed on a later line (after a pickup lyric): the line above stays open
      bar.closed = closed && bar.row === S.rows.length - 1;
      // a bar whose written lengths do not fill (or overflow) the meter
      if (t !== null && Math.abs(t - MBU) > 1e-6) {
        S.warnings.push({ start: W.barN, written: t, meter: MBU, tok: sl[0].tok });
      }
      S.barLines.push(W.barN);
      W.barN += len;
      W.slots = [];
      W.barSlash = false;
    }
    W.runQ = 0;
  };
  const repStart = () => { finishBar(true); W.repEv = S.events.length; W.repT = W.barN; };
  const repEnd = () => {
    finishBar(true);
    const d = W.barN - W.repT, n = S.events.length;
    for (let i = W.repEv; i < n; i++) {
      const e = S.events[i];
      addEvent(S, e.t + d, e.kind, e.chord, e.tok, e.acc, e.hit);
    }
    for (const b of S.barLines.filter((b) => b >= W.repT - 1e-9 && b < W.barN - 1e-9)) S.barLines.push(b + d);
    W.barN += d;
    W.repEv = S.events.length; W.repT = W.barN;
  };
  const cwRow = () => {
    const r = lastRow(S);
    if (!r || r.kind !== ROW.BARS || W.rowLine !== ctx.line) {
      const nr = addRow(S, ROW.BARS);
      W.rowLine = ctx.line;
      nr.barred = W.lineBarred;
    }
  };
  const slot = (n0, n1, kind, chord) => {
    if (!W.lineBarred && W.slots.length) finishBar();
    if (!W.slots.length) { cwRow(); addBar(S, S.MB * S.MU); }
    else {
      // a bar carried over from the previous line gets a piece on this line's row
      cwRow();
      if (S.bars[S.bars.length - 1].row !== S.rows.length - 1) addBar(S, S.MB * S.MU).cont = true;
    }
    const tok = addTok(ctx, n0, n1, kind);
    tok.chord = chord;
    if (W.slots.length < 1000) {
      W.slots.push({ tok, dur: 0, expl: false, beats: 1, hits: [], chord });
      W.lastTok = tok;
    }
  };
  // length of the symbol m at N[p]: an accent next to plain notes takes their
  // length, alone its legend length
  const symLen = (p, m) => {
    let q = 0;
    if (m.acc) {
      let j = p + m.sym.length, mm;
      while (q === 0 && (mm = symAt(ms, N, j))) { if (!mm.acc) q = mm.q; else j += mm.sym.length; }
      if (q === 0 && W.symEnd === p && W.runQ > 0) q = W.runQ;
      if (q === 0) q = m.q;
    } else q = W.runQ = m.q;
    W.symEnd = p + m.sym.length;
    return q;
  };
  const note = (n0, m) => {
    const q = symLen(n0, m);
    if (!W.slots.length) slot(n0, n0, K.HOLD, null);
    if (!W.slots.length) return;
    const s = W.slots[W.slots.length - 1];
    const dh = { sym: m.sym, acc: m.acc, t: s.dur, gap: s.tok.hits.length > 0 && n0 > 0 && N[n0 - 1] === ' ',
      o0: OPOS[n0], o1: OPOS[n0 + m.sym.length] };
    s.tok.hits.push(dh);
    s.hits.push({ off: s.dur, acc: m.acc, dh });
    s.dur += q; s.expl = true;
  };
  const isSpaceLike = (c) => c === ' ' || c === '|' || c === '[' || c === ']';
  const nextContinues = (j) => {
    if (N[j] === '#') return false;
    while (j < N.length && N[j] === ' ') j++;
    const c = j < N.length ? N[j] : '\n';
    return !(c === '\n' || c === '{' || c === '|' || (c === ':' && N[j + 1] === '|') ||
      (c === '[' && (N[j + 1] === '|' || N[j + 1] === ':' || (!isRoot(N[j + 1]) && !symAt(ms, N, j + 1)))));
  };

  let pos = 0;
  while (pos < N.length) {
    const ls = pos;
    let le = ls;
    while (le < N.length && N[le] !== '\n') le++;
    pos = le + 1;
    ctx.line++;
    W.lastTok = null;
    let p = ls;
    while (p < le && N[p] === ' ') p++;
    let e = le;
    while (e > p && N[e - 1] === ' ') e--;
    W.lineBarred = N.slice(ls, le).includes('|');
    let q = p + 1;
    while (q < e && N[q] !== ']') q++;
    if (p >= le || N[ls] === '#' || N[p] === '{') finishBar();
    if (p >= le) { addRow(S, ROW.BLANK); continue; }
    if (N[ls] === '#') { addRow(S, ROW.TEXT, OPOS[ls], OPOS[le]); continue; }
    if (N[p] === '[' && q === e - 1 && q > p + 1 && !parseChord(N, p + 1, q) && !W.lineBarred && !symAt(ms, N, p + 1) &&
        !(q - p - 1 === 1 && (N[p + 1] === '%' || N[p + 1] === '_')) &&
        !N.startsWith('N.C.', p + 1) && !N.startsWith('NC]', p + 1)) {
      finishBar();
      addRow(S, ROW.LABEL, OPOS[p + 1], OPOS[q]);
      continue;
    }
    if (N[p] === '{') {
      // {title:...} {subtitle:...} {key:...} {comment:...} are shown, other directives skipped
      q = p + 1;
      while (q < le && N[q] !== ':' && N[q] !== '}') q++;
      let de = q;
      while (de < le && N[de] !== '}') de++;
      const name = N.slice(p + 1, q);
      if (q < le && N[q] === ':' && ['title', 't', 'subtitle', 'st', 'key', 'comment', 'c', 'comment_italic', 'ci', 'cb'].includes(name)) {
        addRow(S, ROW.TEXT, OPOS[name === 'key' ? p + 1 : q + 1], OPOS[de]);
      }
      continue;
    }
    p = ls;
    while (p < le) {
      const c = N[p];
      if (c === '[') {
        q = p + 1;
        while (q < le && N[q] !== ']') q++;
        if (q >= le) { p++; continue; }
        let a = p + 1, b = q;
        while (a < b && N[a] === ' ') a++;
        while (b > a && N[b - 1] === ' ') b--;
        const inner = N.slice(a, b);
        if (inner === '|' || inner === '||') finishBar(true);
        else if (inner === '|:') repStart();
        else if (inner === ':|') repEnd();
        else if (inner === 'N.C.' || inner === 'NC') slot(a, b, K.STOP, null);
        else {
          // [----] [>>>>] [---- ----]: only length symbols and spaces
          let valid = b > a, j = a, m;
          while (j < b) {
            if ((m = symAt(ms, N, j))) j += m.sym.length;
            else if (N[j] === ' ') j++;
            else { valid = false; break; }
          }
          if (valid) {
            for (j = a; j < b;) { if ((m = symAt(ms, N, j))) { note(j, m); j += m.sym.length; } else j++; }
          } else if (b - a === 1 && '%=_'.includes(N[a])) {
            slot(a, b, N[a] === '%' ? K.STREAK : N[a] === '=' ? K.HOLD : K.STOP, null);
          } else if (b > a && isRoot(N[a])) {
            const chord = parseChord(N, a, b, o.octave, o.transpose);
            slot(a, b, chord ? K.PLAY : K.ERR, chord);
          }
        }
        p = q + 1;
        continue;
      }
      if (c === ':' && N[p + 1] === '|') { repEnd(); p += 2; continue; }
      if (c === '|') { if (N[p + 1] === ':') { repStart(); p += 2; } else { finishBar(true); p++; } continue; }
      const m = symAt(ms, N, p);
      if (m) { note(p, m); p += m.sym.length; continue; }
      if (c === '/' && (p === ls || isSpaceLike(N[p - 1])) && (p + 1 >= le || isSpaceLike(N[p + 1]))) {
        if (!W.slots.length) slot(p, p + 1, K.HOLD, null); else W.slots[W.slots.length - 1].beats++;
        W.barSlash = true;
        p++;
        continue;
      }
      // lyric
      const r = lastRow(S);
      if (W.lastTok) {
        if (c !== ' ') {
          if (W.lastTok.ly0 < 0) W.lastTok.ly0 = OPOS[p];
          W.lastTok.ly1 = OPOS[p + 1];
          r.hasLy = true;
        }
      } else if (c !== ' ' || (W.rowLine === ctx.line && r && r.ly0 >= 0)) {
        cwRow();
        const rr = lastRow(S);
        rr.hasLy = true;
        if (rr.ly0 < 0) {
          rr.ly0 = OPOS[p];
          // pickup before the first chord of the line: sung over the chord still sounding
          let j = S.tokens.length - 1;
          while (j >= 0 && (S.tokens[j].kind === K.HOLD || S.tokens[j].kind === K.STREAK)) j--;
          rr.pre = j;
        }
        rr.ly1 = OPOS[p + 1];
      }
      p++;
    }
    // a bar that ends with its line is drawn closed; only one carried over to the next line stays open
    if (!(W.slots.length && W.lineBarred && nextContinues(pos))) finishBar(true);
    // the faint chord over a pickup only makes sense when chords follow on the line
    const lr = lastRow(S);
    if (lr && W.rowLine === ctx.line && lr.pre >= 0 && !lr.bars.length) lr.pre = -1;
  }
  finishBar();
  S.total = W.barN;
}

// ------------------------------------------------------------------ playback
// Which event decides what is sounding at event i (skips =, % and notes).
function definingEvent(events, i, loop) {
  let j = i, n = 0;
  if (i < 0 && loop) j = events.length - 1;
  while (j >= 0 && n < events.length && [K.HOLD, K.STREAK, K.HIT].includes(events[j].kind)) {
    j--; n++;
    if (j < 0 && loop && i >= 0) j = events.length - 1;
  }
  return n >= events.length ? -1 : j;
}
function lastEventAt(events, t) {
  let lo = 0, hi = events.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (events[mid].t <= t + 1e-6) lo = mid + 1; else hi = mid; }
  return lo - 1;
}

// Note-ons of one pass through the song: [{ t, notes, vel }] (for tests).
function renderNotes(S, { rhythm = true, vel = 100, accVel = 127 } = {}) {
  const out = [];
  let cur = [];
  for (const e of S.events) {
    if (e.kind === K.PLAY || e.kind === K.STOP || e.kind === K.ERR) {
      cur = e.kind === K.PLAY ? e.chord.notes : [];
      if (cur.length) out.push({ t: e.t, notes: cur, vel: rhythm && e.acc ? accVel : vel });
    } else if (e.kind === K.STREAK) {
      if (cur.length) out.push({ t: e.t, notes: cur, vel });
    } else if (e.kind === K.HIT && rhythm) {
      if (cur.length) out.push({ t: e.t, notes: cur, vel: e.acc ? accVel : vel });
    }
  }
  return out;
}

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

})();
