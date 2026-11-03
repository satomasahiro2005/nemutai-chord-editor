// Chord sheet engine for the web editor. Same rules as Rechord_MIDI_Player.jsfx
// (rechord voicing and placement, ChordWiki bars / lengths / legend); the test
// in test/web_vs_jsfx.mjs checks both produce the same notes.

export const K = { STOP: 0, PLAY: 1, HOLD: 2, STREAK: 3, ERR: 4, HIT: 5 };
export const ROW = { BARS: 0, TEXT: 1, BLANK: 2, LABEL: 3 };
const OFF13 = [0, 4, 7, 10, 14, 17, 21];
const MAJ = '\x01', HDIM = '\x02';

// ------------------------------------------------------------------ text
// Full-width ASCII, sharps/flats and the maj / half-dim symbols are folded to
// single characters, as rechord does. opos maps back to the original text.
export function normalize(raw) {
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
export function translateType(ty) {
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
export function parseChord(N, t0, t1, octave = 3, transpose = 0) {
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
  // the chord tones as offsets from the root, for the accompaniment's own voicing
  const iv = [];
  for (let k = 0; k < 7; k++) if (TN[k] !== null) iv.push({ k, s: OFF13[k] + TN[k] });
  // on-chord: bass below the chord unless it names the root itself
  let bass = null;
  if (d0 >= 0 && !(dsh && dfl) && N.slice(d0, dend) !== N.slice(t0, rend)) {
    let bm = 12 * (octave + 1) + LETTER[N[d0]] + dacc;
    if (NL[0] <= bm) bm -= 12;
    NL.unshift(bm);
    bass = bm + transpose;
  }
  return {
    notes: NL.map((x) => Math.max(0, Math.min(127, x + transpose))),
    rpc: (LETTER[c] + acc + 24) % 12,
    root: base + transpose, iv, bass,
  };
}

// a chord name on its own, e.g. "Am7" or "C/E"
export function chordFromName(name, transpose = 0, octave = 3) {
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
// the tonic (of the relative major) in effect at original text position o
export function tonicAt(S, o) {
  let t = S.tonic;
  for (const k of S.keys || []) if (k.o <= o) t = k.tonic;
  return t;
}

// opts: { mode: 'auto'|'rechord'|'chordwiki', beatsPerBar: 0 (= song / project),
//         projectTs: [4, 4], octave: 3, transpose: 0 }
export function parse(raw, opts = {}) {
  const o = { mode: 'auto', beatsPerBar: 0, projectTs: [4, 4], octave: 3, transpose: 0, ...opts };
  const { n: N, opos: OPOS } = normalize(raw);
  const S = {
    rows: [], tokens: [], events: [], bars: [], warnings: [], barLines: [],
    legend: { bpm: 0, ts: null, key: null, minor: false, swing8: false, swing16: false, keys: [] },
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

  // each {key:} holds from its line on (the first one also before it); with
  // none, the key is the first chord's root
  S.keys = S.legend.keys.map((k) => ({ o: OPOS[k.at], tonic: k.tonic }));
  if (S.keys.length) S.tonic = S.keys[0].tonic;
  else { const t = S.tokens.find((t) => t.chord); S.tonic = t ? t.chord.rpc : 0; }
  for (const t of S.tokens) if (t.chord) t.tonic = tonicAt(S, t.o0);
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
    // as on ChordWiki, the key must follow the colon right away ({key: C} is not a key)
    if (j < le && N.startsWith('{key:', j)) {
      let k = j + 5;
      if (isRoot(N[k])) {
        let pc = LETTER[N[k]]; k++;
        if (N[k] === '#') { pc++; k++; } else if (N[k] === 'b') { pc--; k++; }
        L.key = (pc + 12) % 12;
        L.minor = N[k] === 'm' && !N.startsWith('maj', k);
        L.keys.push({ at: j, tonic: (L.key + (L.minor ? 3 : 0)) % 12 });
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
export function definingEvent(events, i, loop) {
  let j = i, n = 0;
  if (i < 0 && loop) j = events.length - 1;
  while (j >= 0 && n < events.length && [K.HOLD, K.STREAK, K.HIT].includes(events[j].kind)) {
    j--; n++;
    if (j < 0 && loop && i >= 0) j = events.length - 1;
  }
  return n >= events.length ? -1 : j;
}
export function lastEventAt(events, t) {
  let lo = 0, hi = events.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (events[mid].t <= t + 1e-6) lo = mid + 1; else hi = mid; }
  return lo - 1;
}

// Note-ons of one pass through the song: [{ t, notes, vel }] (for tests).
export function renderNotes(S, { rhythm = true, vel = 100, accVel = 127 } = {}) {
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

// ------------------------------------------------------------------ accompaniment
// A band of two parts, as Hookpad has it, in place of striking the written
// voicing: the right hand plays 3-4 chord tones around middle C that move as
// little as possible from the last chord, and the bass plays the root (or the
// on-chord bass) in octave 2. Each part has its own pattern on a sixteenth-note
// grid that follows the bar (and the shuffle); every chord change is struck
// where it is written.
export const HARM = ['block', 'whole', 'quarter', 'eighth', 'sixteenth', 'synco', 'arp', 'arp16'];
export const BASS = ['none', 'whole', 'dotted', 'eighth', 'fifth'];

const mod12 = (x) => ((x % 12) + 12) % 12;
function pianoVoicing(ch, prev) {
  const bass = 35 + mod12((ch.bass ?? ch.root) - 35);   // B1..A#2
  const t = ch.iv.slice();
  const drop = (f) => { const i = t.findIndex(f); if (t.length > 4 && i >= 0) t.splice(i, 1); };
  drop((x) => x.k === 2 && x.s === 7);   // the plain fifth
  // the root, which the bass has (3-note right hand for 7ths)
  if (ch.bass === null && t.length >= 4) t.splice(t.findIndex((x) => x.k === 0), 1);
  while (t.length > 4) t.splice(t.length - 2, 1);   // keep the top tension
  const pcs = [...new Set(t.map((x) => mod12(ch.root + x.s)))].sort((a, b) => mod12(a - ch.root) - mod12(b - ch.root));
  let best = null;
  for (let r = 0; r < pcs.length; r++) {
    const ns = [53 + mod12(pcs[r] - 53)];   // lowest note F3..E4
    for (let q = 1; q < pcs.length; q++) { const n = ns[q - 1]; ns.push(n + (mod12(pcs[(r + q) % pcs.length] - n) || 12)); }
    const avg = ns.reduce((a, b) => a + b, 0) / ns.length, top = ns[ns.length - 1];
    let cost = prev ? Math.abs(avg - prev.avg) + 0.5 * Math.abs(top - prev.top) + 0.15 * Math.abs(avg - 64) : Math.abs(avg - 64);
    if (ns.length > 1 && ns[1] - ns[0] === 1) cost += 2;   // a second at the bottom is muddy
    if (!best || cost < best.cost) best = { rh: ns, avg, top, cost };
  }
  const p5 = ch.bass === null && ch.iv.some((x) => x.k === 2 && x.s === 7);
  // right-hand broken chord: up through the voicing to the octave and back
  const up = [...best.rh, best.rh[0] + 12];
  return { bass, fifth: p5 ? (bass + 7 <= 50 ? bass + 7 : bass - 5) : bass, rh: best.rh, avg: best.avg, top: best.top,
           arp: up.concat(up.slice(1, -1).reverse()) };
}

// sixteenth j of a bar of n sixteenths, spb sixteenths a beat -> what the part
// plays there (null: nothing; len: the note's length in sixteenths, else until
// the part's next note; soft: off the beat)
function harmAt(style, j, n, spb) {
  const beat = j % spb === 0 ? j / spb : -1, e8 = j % 2 === 0 ? j / 2 : -1, spb8 = spb / 2;
  switch (style) {
    case 'whole': return j === 0 ? {} : null;
    case 'quarter': return beat >= 0 ? { len: spb * 0.9, soft: beat > 0 } : null;
    case 'eighth': return e8 >= 0 ? { len: 1.6, soft: e8 % spb8 !== 0 } : null;
    case 'sixteenth': return { len: 0.8, soft: beat !== 0, ghost: e8 < 0 };
    case 'synco':
      if (n !== 16) return beat >= 0 ? { soft: beat > 0 } : null;
      return [0, 6, 12].includes(j) ? { soft: j > 0 } : null;
    case 'arp': return e8 >= 0 ? {} : null;
    case 'arp16': return {};
  }
  return null;
}
function bassAt(style, j, n, spb) {
  const beat = j % spb === 0 ? j / spb : -1, e8 = j % 2 === 0 ? j / 2 : -1, nb = n / spb;
  const half = nb % 2 === 0 && nb > 2 ? nb / 2 : 0;   // the middle of the bar, in beats
  switch (style) {
    case 'whole': return j === 0 ? {} : null;
    // Hookpad's Piano Bass Dotted: a dotted quarter and an eighth, every half bar
    case 'dotted': {
      const h = half ? half * spb : n, k = j % h;
      return k === 0 ? {} : spb === 4 && k === 6 && h >= 8 ? { soft: true } : null;
    }
    case 'eighth': return e8 >= 0 ? { len: 1.7, soft: j % spb !== 0 } : null;
    case 'fifth': return beat === 0 ? {} : half && beat === half ? { fifth: true } : null;
  }
  return null;
}

// One pass of the accompaniment as notes [{ t, n, d, v }] sorted by time
// (quarters). harm 'block' is the written voicing and is not played from here.
// rhythm: a bar whose written rhythm is more than an even run of notes (an
// accent, a キメ) is played as written, with both parts, instead of the patterns.
export function accompany(S, { harm = 'whole', bass = 'dotted', vel = 100, rhythm = true } = {}) {
  const out = [];
  if (harm === 'block' || !S.events.length || S.total <= 0) return out;
  const segs = [];
  let ch = null;
  for (const e of S.events) {
    if (e.kind === K.PLAY) ch = e.chord;
    else if (e.kind === K.STOP || e.kind === K.ERR) ch = null;
    else if (e.kind !== K.STREAK || !ch) continue;
    if (segs.length) segs[segs.length - 1].t1 = e.t;
    segs.push({ t0: e.t, t1: S.total, ch, acc: e.acc });
  }
  const bl = [...new Set(S.barLines)].sort((a, b) => a - b);
  if (!bl.length || bl[0] > 1e-6) bl.unshift(0);
  const barAt = (t) => { let i = 0; while (i + 1 < bl.length && bl[i + 1] <= t + 1e-6) i++; return i; };
  const barEnd = (i) => (i + 1 < bl.length ? bl[i + 1] : S.total);
  const g = 0.25;
  const spb = Math.max(1, Math.round(S.MU / g));
  // shuffle as the parser does it: 16ths and/or 8ths off the beat come later
  const swing = (p) => {
    if (S.legend.swing16) { const f = p - Math.floor(p * 2 + 1e-6) / 2; if (Math.abs(f - 0.25) < 1e-4) p += 1 / 12; }
    if (S.legend.swing8) { const f = p - Math.floor(p + 1e-6); if (Math.abs(f - 0.5) < 1e-4) p += 1 / 6; }
    return p;
  };
  const unswing = (p) => {
    if (S.legend.swing8) { const f = p - Math.floor(p + 1e-6); if (Math.abs(f - 0.5 - 1 / 6) < 1e-4) p -= 1 / 6; }
    if (S.legend.swing16) { const f = p - Math.floor(p * 2 + 1e-6) / 2; if (Math.abs(f - 0.25 - 1 / 12) < 1e-4) p -= 1 / 12; }
    return p;
  };
  const V = (x) => Math.max(1, Math.min(127, Math.round(x)));
  const push = (t, n, end, v) => { if (end > t + 1e-6 && n >= 0 && n <= 127) out.push({ t, n, d: end - t, v: V(v) }); };

  // bars played as written: an accent, or notes that are not an even run from the bar's start
  const kime = new Map();   // bar index -> [{ t, acc }]
  if (rhythm) {
    const byBar = new Map();
    for (const e of S.events) {
      if (![K.PLAY, K.STREAK, K.HIT].includes(e.kind) || e.t >= S.total - 1e-6) continue;
      const bi = barAt(e.t);
      if (!byBar.has(bi)) byBar.set(bi, []);
      const list = byBar.get(bi), last = list[list.length - 1];
      if (last && Math.abs(last.t - e.t) < 1e-6) last.acc = last.acc || e.acc;
      else list.push({ t: e.t, acc: e.acc });
      if (e.kind === K.HIT) list.written = true;
    }
    // (only bars with written lengths: chords alone are placed, not written in rhythm)
    for (const [bi, list] of byBar) {
      if (!list.written || (list.length < 2 && !list.some((x) => x.acc))) continue;
      const b0 = bl[bi], ps = list.map((x) => unswing(x.t - b0)), gap = ps.length > 1 ? ps[1] - ps[0] : barEnd(bi) - b0;
      const even = Math.abs(ps[0]) < 1e-4 && ps.every((p, k) => Math.abs(p - k * gap) < 1e-4) &&
        Math.abs(barEnd(bi) - b0 - ps.length * gap) < 1e-4;
      if (list.some((x) => x.acc) || !even) kime.set(bi, list);
    }
  }
  const inKime = (t) => kime.has(barAt(t));

  // the hits of one part over a chord: its pattern, and the chord change itself
  const hitsOf = (sg, at) => {
    const hits = [];
    for (let bi = barAt(sg.t0); bi < bl.length && bl[bi] < sg.t1 - 1e-6; bi++) {
      if (kime.has(bi)) continue;
      const b0 = bl[bi], b1 = barEnd(bi), n = Math.round((b1 - b0) / g);
      for (let j = 0; j < n; j++) {
        const p = b0 + j * g;
        if (p < sg.t0 - 1e-6 || p >= sg.t1 - 1e-6) continue;
        const h = at(j, n, spb);
        if (h) hits.push({ ...h, t: b0 + swing(j * g), b1, bar: j === 0 });
      }
    }
    if (!inKime(sg.t0) && (!hits.length || hits[0].t > sg.t0 + 1e-6)) hits.unshift({ t: sg.t0, b1: barEnd(barAt(sg.t0)) });
    if (hits.length && Math.abs(hits[0].t - sg.t0) < 1e-6) Object.assign(hits[0], { start: true, soft: false, ghost: false, fifth: false });
    hits.forEach((h, i) => { h.end = Math.min(sg.t1, i + 1 < hits.length ? hits[i + 1].t : sg.t1, h.len ? h.t + h.len * g : Infinity); });
    return hits;
  };
  let prev = null;
  for (const sg of segs) {
    if (!sg.ch || sg.t1 <= sg.t0 + 1e-6) continue;
    const vo = pianoVoicing(sg.ch, prev);
    prev = vo; sg.vo = vo;
    const acc = sg.acc ? 27 : 0;
    let ai = 0;
    for (const h of hitsOf(sg, (j, n, spb) => harmAt(harm, j, n, spb))) {
      const v = (h.ghost ? vel * 0.6 : h.soft ? vel * 0.75 : vel * 0.9) + (h.start ? acc : 0);
      if (harm === 'arp' || harm === 'arp16') {
        // the broken chord starts again at each bar and chord, and is pedalled to the bar's end
        if (h.bar || h.start) ai = 0;
        push(h.t, vo.arp[ai++ % vo.arp.length], Math.min(sg.t1, h.b1), ai === 1 ? v : vel * 0.75);
      } else {
        const end = harm === 'whole' ? Math.min(h.end, h.b1) : h.end;
        for (const n of vo.rh) push(h.t, n, end, v);
      }
    }
    if (bass !== 'none') {
      for (const h of hitsOf(sg, (j, n, spb) => bassAt(bass, j, n, spb))) {
        push(h.t, h.fifth ? vo.fifth : vo.bass, h.end, (h.soft ? vel * 0.8 : vel * 0.95) + (h.start ? acc : 0));
      }
    }
  }
  // the bars played as written: chord and bass on every written note
  for (const [bi, list] of kime) {
    list.forEach((x, k) => {
      const sg = segs.find((s) => s.vo && s.t0 <= x.t + 1e-6 && x.t < s.t1 - 1e-6);
      if (!sg) return;
      const end = Math.min(sg.t1, k + 1 < list.length ? list[k + 1].t : barEnd(bi));
      const v = vel * 0.9 + (x.acc ? 27 : 0);
      for (const n of sg.vo.rh) push(x.t, n, end, v);
      if (bass !== 'none') push(x.t, sg.vo.bass, end, vel * 0.95 + (x.acc ? 27 : 0));
    });
  }
  out.sort((a, b) => a.t - b.t || a.n - b.n);
  // the same key struck again while it still sounds: the earlier one ends there
  const last = new Map();
  for (const x of out) {
    const p = last.get(x.n);
    if (p && p.t + p.d > x.t) p.d = x.t - p.t;
    last.set(x.n, x);
  }
  return out.filter((x) => x.d > 1e-6);
}
