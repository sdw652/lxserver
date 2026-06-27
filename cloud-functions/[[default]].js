// cloud-functions/[[default]].js
// Catch-all serverless entry point for lx-music-sync-server
// Bridges EdgeOne Makers cloud function requests to the existing Node.js HTTP server handler
// without requiring actual port binding, by intercepting http.createServer and using mock req/res objects.

import http from 'node:http'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'

const require = createRequire(import.meta.url)

// ===== HTTP Server Interception =====
let capturedHttpServer = null
let appReady = false
let bootstrapPromise = null
let httpPatched = false

/**
 * Patch http.createServer so we can capture the server instance created by
 * lx-music-sync-server's handleStartServer, and patch its listen() to not
 * actually bind to a port (emit 'listening' immediately instead).
 */
function patchHttp() {
  if (httpPatched) return
  httpPatched = true

  const _originalCreateServer = http.createServer
  http.createServer = function (...args) {
    const server = _originalCreateServer.apply(http, args)
    capturedHttpServer = server

    const _originalListen = server.listen.bind(server)
    server.listen = function (...listenArgs) {
      // Do not bind to a real port; emit 'listening' on next tick to resolve startServer's promise
      process.nextTick(() => {
        server.emit('listening')
      })
      return server
    }

    return server
  }
}

/**
 * Bootstrap the application once.
 * Loads the compiled server entry (server/index.js) which triggers all
 * initialization (config, users, modules) and calls startServer.
 * Our patched http.createServer captures the HTTP server with its request handler,
 * and patched listen avoids real port binding.
 */
async function bootstrap() {
  if (appReady) return
  if (bootstrapPromise) return bootstrapPromise

  bootstrapPromise = (async () => {
    patchHttp()

    if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production'

    try {
      // Load the main application entry point.
      // server/index.js is the compiled output of src/index.ts which does all
      // initialization and calls startServer(port, bindIP).
      require('../server')
    } catch (err) {
      console.error('[Bootstrap] Module load error:', err.message)
      // Some initialization errors are non-fatal; the HTTP server may still be created
    }

    // Wait for the HTTP server to be created (async initialization inside startServer)
    for (let i = 0; i < 50; i++) {
      if (capturedHttpServer) break
      await new Promise(r => setTimeout(r, 200))
    }

    if (!capturedHttpServer) {
      throw new Error('HTTP server was not created during bootstrap')
    }

    // Additional wait for post-creation async initialization (musicSdk.init, initUserApis, etc.)
    await new Promise(r => setTimeout(r, 1500))

    appReady = true
    console.log('[Bootstrap] lx-music-sync-server ready for serverless requests')
  })()

  return bootstrapPromise
}

// ===== Mock Objects =====

/**
 * Mock IncomingMessage that mimics Node.js http.IncomingMessage interface.
 * Uses EventEmitter to simulate stream data/end events for request body reading.
 */
class MockIncomingMessage extends EventEmitter {
  constructor(options) {
    super()
    this.url = options.url || '/'
    this.method = options.method || 'GET'
    this.headers = Object.assign({}, options.headers)
    this.httpVersion = '1.1'
    this.httpVersionMajor = 1
    this.httpVersionMinor = 1
    this.socket = {
      remoteAddress: options.remoteAddress || '127.0.0.1',
      remotePort: 0,
      destroyed: false,
      destroy() { this.destroyed = true },
    }
    this._body = options.body || null
    this._bodyEmitted = false
  }

  /**
   * Emit request body data asynchronously via process.nextTick.
   * This ensures the handler's readBody() listeners are registered before data arrives,
   * mimicking real stream behavior.
   */
  emitBody() {
    if (this._bodyEmitted) return
    this._bodyEmitted = true
    process.nextTick(() => {
      if (this._body && this._body.length > 0) {
        this.emit('data', this._body)
      }
      this.emit('end')
    })
  }
}

/**
 * Mock ServerResponse that captures the handler's output (status, headers, body).
 * Mimics Node.js http.ServerResponse interface (writeHead, setHeader, write, end).
 */
class MockServerResponse extends EventEmitter {
  constructor() {
    super()
    this.statusCode = 200
    this.statusMessage = 'OK'
    this._headers = {}
    this._chunks = []
    this._finished = false
    this.headersSent = false
  }

  writeHead(statusCode, headers) {
    this.statusCode = statusCode
    this.headersSent = true
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        this._headers[k.toLowerCase()] = String(v)
      }
    }
    return this
  }

  setHeader(name, value) {
    this._headers[name.toLowerCase()] = String(value)
    return this
  }

  getHeader(name) {
    return this._headers[name.toLowerCase()]
  }

  write(data, encoding) {
    if (typeof data === 'string') {
      this._chunks.push(Buffer.from(data, encoding || 'utf8'))
    } else if (Buffer.isBuffer(data)) {
      this._chunks.push(data)
    } else if (data) {
      this._chunks.push(Buffer.from(data))
    }
    return true
  }

  end(data, encoding) {
    if (data) {
      if (typeof data === 'string') {
        this._chunks.push(Buffer.from(data, encoding || 'utf8'))
      } else if (Buffer.isBuffer(data)) {
        this._chunks.push(data)
      } else if (ArrayBuffer.isView(data)) {
        this._chunks.push(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
      } else if (data instanceof ArrayBuffer) {
        this._chunks.push(Buffer.from(data))
      }
    }
    this._finished = true
    this.emit('finish')
    return this
  }

  getBody() {
    return Buffer.concat(this._chunks)
  }
}

// ===== Request Handling =====

/**
 * Main cloud function handler.
 * Bootstraps the app on first invocation, then routes each request through
 * the captured HTTP server's request handler using mock IncomingMessage/ServerResponse.
 */
export async function onRequest(context) {
  try {
    await bootstrap()
  } catch (err) {
    return new Response(`Service Unavailable: ${err.message}`, { status: 503 })
  }

  if (!capturedHttpServer) {
    return new Response('Service Unavailable: Server not initialized', { status: 503 })
  }

  const webReq = context.request
  const urlObj = new URL(webReq.url)

  // Build headers (lowercase keys per Node.js http convention)
  const headers = {}
  for (const [key, value] of webReq.headers.entries()) {
    headers[key.toLowerCase()] = value
  }
  if (!headers['host']) {
    headers['host'] = urlObj.host || 'localhost'
  }

  // Read request body for non-GET/HEAD methods
  let bodyBuffer = null
  if (webReq.method !== 'GET' && webReq.method !== 'HEAD' && webReq.body) {
    const ab = await webReq.arrayBuffer()
    if (ab.byteLength > 0) {
      bodyBuffer = Buffer.from(ab)
    }
  }

  // Determine client IP from proxy headers or fallback
  const remoteAddress =
    (headers['x-forwarded-for'] && headers['x-forwarded-for'].split(',')[0].trim()) ||
    headers['x-real-ip'] ||
    '127.0.0.1'

  // Create mock request and response
  const req = new MockIncomingMessage({
    url: urlObj.pathname + urlObj.search,
    method: webReq.method,
    headers,
    remoteAddress,
    body: bodyBuffer,
  })

  const res = new MockServerResponse()

  // Route the request through the captured HTTP server's handler
  capturedHttpServer.emit('request', req, res)

  // Emit request body asynchronously (after handler registers its readBody listeners)
  req.emitBody()

  // Wait for the response to finish (handler may write asynchronously via readBody().then())
  await new Promise(resolve => {
    if (res._finished) {
      resolve()
      return
    }
    res.on('finish', resolve)
    // Safety timeout: if the handler never calls res.end() (e.g. SSE streams), resolve after 30s
    setTimeout(() => {
      if (!res._finished) {
        res.statusCode = 504
        res._chunks = [Buffer.from('Gateway Timeout: response not completed')]
        res._finished = true
      }
      resolve()
    }, 30000)
  })

  // Build EdgeOne Response from captured response data
  const body = res.getBody()
  const respHeaders = new Headers()

  for (const [key, value] of Object.entries(res._headers)) {
    // Skip HTTP/1.1 hop-by-hop headers that are invalid in fetch Response
    if (key === 'transfer-encoding' || key === 'connection') continue
    respHeaders.set(key, value)
  }

  return new Response(body, {
    status: res.statusCode,
    headers: respHeaders,
  })
}
