import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import { handleAppApiRequest } from '../../supabase/functions/app-api/index.ts';
import { handleAdminApiRequest } from '../../supabase/functions/admin-api/index.ts';

const port = Number.parseInt(process.env.PORT || '8787', 10);
const host = process.env.HOST || '0.0.0.0';
const maximumBodyBytes = 2 * 1024 * 1024;

function copyHeaders(source: IncomingHttpHeaders) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(source)) {
    if (Array.isArray(value)) value.forEach(item => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumBodyBytes) throw new RangeError('Request body is too large');
    chunks.push(buffer);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

async function sendWebResponse(nodeResponse: ServerResponse, webResponse: Response) {
  webResponse.headers.forEach((value, name) => nodeResponse.setHeader(name, value));
  nodeResponse.setHeader('X-Content-Type-Options', 'nosniff');
  nodeResponse.setHeader('Referrer-Policy', 'no-referrer');
  nodeResponse.statusCode = webResponse.status;
  nodeResponse.end(Buffer.from(await webResponse.arrayBuffer()));
}

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).pathname;
    if (request.method === 'GET' && pathname === '/health') {
      return sendJson(response, 200, { ok: true, runtime: 'nodejs', service: 'beinong-app-api' });
    }
    const handler = pathname === '/api/app-api'
      ? handleAppApiRequest
      : pathname === '/api/admin-api'
        ? handleAdminApiRequest
        : null;
    if (!handler) {
      return sendJson(response, 404, { ok: false, message: '找不到 API 路徑' });
    }

    const headers = copyHeaders(request.headers);
    const forwardedProtocol = headers.get('x-forwarded-proto') || 'https';
    const url = new URL(request.url || '/', `${forwardedProtocol}://${request.headers.host || 'localhost'}`);
    const body = ['GET', 'HEAD'].includes(request.method || '') ? undefined : await readBody(request);
    const webRequest = new Request(url, { method: request.method, headers, body });
    await sendWebResponse(response, await handler(webRequest));
  } catch (error) {
    if (error instanceof RangeError) return sendJson(response, 413, { ok: false, message: '請求內容過大' });
    console.error('node-api failed', error instanceof Error ? error.message : String(error));
    return sendJson(response, 500, { ok: false, message: 'API 處理失敗，請稍後再試' });
  }
});

server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.listen(port, host, () => console.log(`Beinong Node.js API listening on ${host}:${port}`));
