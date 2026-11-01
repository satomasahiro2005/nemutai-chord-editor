// Builds public/chordwiki-player.user.js: the engine and the ChordWiki page
// script in one file, as userscript managers want.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const engine = fs.readFileSync(path.join(root, 'public/engine.js'), 'utf8').replace(/^export /gm, '');
const page = fs.readFileSync(path.join(root, 'userscript/chordwiki.js'), 'utf8');
const url = 'https://chord.nemut.ai/chordwiki-player.user.js';
const header = `// ==UserScript==
// @name         nemutai Chord Player for ChordWiki
// @namespace    https://chord.nemut.ai/
// @version      ${pkg.version}
// @description  Plays ChordWiki chord sheets along a timeline, with chords coloured by degree.
// @description:ja ChordWiki のコード譜をタイムラインに合わせて鳴らし、コードを度数で色分けします。
// @match        https://ja.chordwiki.org/wiki/*
// @match        https://ja.chordwiki.org/wiki.cgi?*
// @grant        none
// @license      MIT
// @homepageURL  https://chord.nemut.ai/
// @downloadURL  ${url}
// @updateURL    ${url}
// ==/UserScript==
`;
fs.writeFileSync(path.join(root, 'public/chordwiki-player.user.js'),
  `${header}\n(() => {\n'use strict';\n${engine}\n${page}\n})();\n`);
console.log('built public/chordwiki-player.user.js');
