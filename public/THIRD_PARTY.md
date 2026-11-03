# Third-party notices

## chord-translator

`translateType()` in `engine.js` is a port of `translateType()` from
[chord-translator](https://github.com/kero-uzura/chord-translator) 0.1.6
(MIT, per its package.json).

```
MIT License

Copyright (c) comorebi notes

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## rechord notation

The Rechord input format and the way chords are voiced and placed in a bar
follow the behaviour of [rechord](https://github.com/comorebi-notes/rechord).
This is an independent implementation written from that behaviour; no rechord
code is included.

## Salamander Grand Piano

The piano sound (`piano/*.mp3`) is made from the
[Salamander Grand Piano V3](https://github.com/sfzinstruments/SalamanderGrandPiano)
by Alexander Holm, licensed under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). One note every three
semitones from A0 to C8, taken from the MP3 set Tone.js hosts
(https://tonejs.github.io/audio/salamander/), cut to 5 seconds with a fade-out
and mixed down to mono at 64 kbps.
