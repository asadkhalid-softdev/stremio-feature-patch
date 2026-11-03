const test=require('node:test');
const assert=require('node:assert/strict');
const {MAX_BYTES,validateFileInfo,inspectSrt}=require('../payload/local-subtitles.js');
const encode=text=>new TextEncoder().encode(text).buffer;
const cue='1\n00:00:01,000 --> 00:00:03,500\nLocal subtitle test.\n';
test('accepts SRT files with numbered, unnumbered, multiline, and CRLF cues',()=>{
  assert.equal(inspectSrt('captions.SRT',encode(cue)).cueCount,1);
  assert.equal(inspectSrt('captions.srt',encode(cue.replace(/\n/g,'\r\n'))).cueCount,1);
  assert.equal(inspectSrt('captions.srt',encode('00:00:01.000 --> 00:00:02.000\nFirst line\nSecond line\n')).cueCount,1);
  assert.equal(inspectSrt('captions.srt',encode(cue+'\n2\n00:00:04,000 --> 00:00:05,000\nAnother cue\n')).cueCount,2);
});
test('accepts UTF-8 BOM and UTF-16 BOM timing syntax without rewriting original bytes',()=>{
  assert.equal(inspectSrt('captions.srt',encode('\uFEFF'+cue)).cueCount,1);
  const bytes=Buffer.from('\uFEFF'+cue,'utf16le');
  const le=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  assert.equal(inspectSrt('captions.srt',le).cueCount,1);
  const be=Buffer.from(bytes);be.swap16();
  assert.equal(inspectSrt('captions.srt',be.buffer.slice(be.byteOffset,be.byteOffset+be.byteLength)).cueCount,1);
});
test('rejects unsupported, empty, oversized, and invalid files',()=>{
  assert.throws(()=>validateFileInfo('captions.txt',10),/\.srt/);
  assert.throws(()=>validateFileInfo('captions.srt',0),/empty/);
  assert.throws(()=>validateFileInfo('captions.srt',MAX_BYTES+1),/10 MB/);
  assert.throws(()=>inspectSrt('captions.srt',encode('Not subtitles')),/valid SRT/);
  assert.throws(()=>inspectSrt('captions.srt',encode('00:00:03,000 --> 00:00:01,000\nBackwards\n')),/valid SRT/);
  assert.throws(()=>inspectSrt('captions.srt',encode('00:72:03,000 --> 00:73:01,000\nInvalid minutes\n')),/valid SRT/);
});
