import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {youtubeFormats} from './youtube.mjs';
import {providerFor} from './extract.mjs';
import {ytdlpFormats} from './ytdlp.mjs';

export async function startBridge(engine, { dataDirectory, port = 17843, onDownload, onOpen } = {}) {
  const token = randomBytes(32).toString('hex');
  const server = http.createServer(async (req, res) => {
    const answer = (status, data) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
    // Browser pages cannot submit requests: no CORS and explicit origin rejection.
    if (req.headers.origin || req.headers.host !== `127.0.0.1:${server.address().port}`) return answer(403, { error: 'Forbidden origin or host.' });
    const auth = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) return answer(401, { error: 'Unauthorized.' });
    if (req.method === 'GET' && req.url === '/health') return answer(200, { ok: true, version: '1.0.0' });
    if (req.method === 'GET' && req.url === '/recent') return answer(200, { ok: true, items: engine.downloads.slice(-3).reverse().map(d => ({ id:d.id, filename:d.filename, status:d.status, progress:d.total ? Math.min(100, Math.floor(d.downloaded/d.total*100)) : null })) });
    if (req.method === 'GET' && req.url === '/open') { await onOpen?.(); return answer(200, { ok:true }); }
    if (req.method !== 'POST' || !['/downloads','/formats'].includes(req.url)) return answer(404, { error: 'Not found.' });
    if (!String(req.headers['content-type']).startsWith('application/json')) return answer(415, { error: 'JSON required.' });
    let size = 0;
    try {
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) { answer(413, { error: 'Request too large.' }); req.destroy(); return; }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(req.url==='/formats'){
        const target=String(body.url||'');
        // Page providers expose their real variants through the same shape the
        // YouTube extractor returns, so the extension menu needs no special case.
        if(providerFor(target)){
          const listing=await ytdlpFormats(target);
          return answer(200,{ok:true,items:listing.rows.map(item=>({
            quality:item.quality,format:item.format,size:item.size,bitrate:item.bitrate,height:item.height,
            title:listing.title,providerFormat:item.youtubeFormat,providerNeedsAudio:item.needsAudio===true,
            providerAudioFormat:item.audioFormatId
          }))});
        }
        return answer(200,{ok:true,items:await youtubeFormats(target)});
      }
      // Browser callers cannot select filesystem destinations or arbitrary app actions.
      const payload = { url: body.url, youtubeFormat:body.youtubeFormat, providerFormat:body.providerFormat, providerNeedsAudio:body.providerNeedsAudio, providerAudioFormat:body.providerAudioFormat, preferredQuality:body.preferredQuality, sabr:body.sabr, startNow: body.startNow === true, audioUrl: body.audioUrl, outputFormat:body.outputFormat, urls: body.urls, filename: body.filename, referer: body.referer, headers: body.headers };
      const result = await (onDownload ? onDownload(payload) : engine.add(payload));
      const ids = Array.isArray(result) ? result : (result?.ids || []);
      // The extension uses `mode` to word its confirmation instead of asking twice.
      answer(201, { ok: true, ids, mode: Array.isArray(result) ? undefined : result?.mode });
    } catch (error) { if (!res.headersSent) answer([429,422].includes(error.statusCode)?error.statusCode:400, { error: error.message }); }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  // Another build (or a second copy of this one) may already own the default
  // port. Walk a small range instead of failing the whole browser bridge; the
  // chosen port is published in bridge.json for the native host.
  const candidates = port === 0 ? [0] : [port, ...Array.from({ length: 20 }, (_, index) => port + index + 1)];
  let bound = false;
  let lastError;
  for (const candidate of candidates) {
    if (candidate > 65535) break;
    try {
      await new Promise((resolve, reject) => {
        const onError = error => { server.removeListener('listening', onListening); reject(error); };
        const onListening = () => { server.removeListener('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(candidate, '127.0.0.1');
      });
      bound = true;
      break;
    } catch (error) {
      lastError = error;
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  if (!bound) throw lastError || new Error('No free local port for the browser bridge.');
  const actualPort = server.address().port;
  await fs.mkdir(dataDirectory, { recursive: true });
  const configPath = path.join(dataDirectory, 'bridge.json');
  try { await fs.writeFile(configPath, JSON.stringify({ port: actualPort, token }), { mode: 0o600 }); }
  catch (error) { server.close(); throw error; }
  return { port: actualPort, async close() {
    await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
    try { const saved = JSON.parse(await fs.readFile(configPath, 'utf8')); if (saved.token === token) await fs.unlink(configPath); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  } };
}
