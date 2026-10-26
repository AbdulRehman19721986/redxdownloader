import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DownloadEngine } from '../core/engine.mjs';
import os from 'node:os';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('overlay uses the approved activation and persistence windows',async()=>{
  const source=await fs.readFile(path.join(root,'extension','content.js'),'utf8');
  assert.match(source,/ACTIVATION_MS\s*=\s*1500/);
  assert.match(source,/GRACE_MS\s*=\s*6000/);
  assert.match(source,/record\.sourceHovering/);
  assert.match(source,/record\.shadow\.querySelector\('\.chooser'\)/);
});

test('provider format selection is stored separately from YouTube format selection',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'redx-provider-format-'));
  const engine=await new DownloadEngine({dataDirectory:path.join(dir,'data'),downloadDirectory:path.join(dir,'out')}).init();
  try{
    const [id]=await engine.add({url:'https://www.tiktok.com/@studio/video/7412345678901234567',providerFormat:'hd_720',providerNeedsAudio:true,providerAudioFormat:'audio_128',queueOnly:true});
    const item=engine.downloads.find(d=>d.id===id);
    assert.equal(item.providerFormat,'hd_720');
    assert.equal(item.providerNeedsAudio,true);
    assert.equal(item.providerAudioFormat,'audio_128');
    assert.equal(item.youtubeFormat,undefined);
  }finally{await engine.close();await fs.rm(dir,{recursive:true,force:true});}
});

test('popup interception and overlay switches default to enabled',async()=>{
  const source=await fs.readFile(path.join(root,'extension','popup.js'),'utf8');
  assert.match(source,/overlayEnabled:true,interceptDownloads:true/);
  assert.match(source,/intercept\.checked=value\.interceptDownloads!==false/);
});
