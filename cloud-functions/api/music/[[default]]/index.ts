/**
 * Cloud Function: /api/music/* (catch-all)
 *
 * 替代原 Node.js 服务器对播放器相关 API 的处理。
 * 由于 Cloud Function 是无状态的，无法使用原服务器的内存 Map 存储 Session，
 * 因此改用 HMAC-SHA256 签名令牌方案：
 *   - 登录成功后生成 {timestamp}.{hmac_hex} 令牌，写入 HttpOnly Cookie
 *   - 验证时检查 Cookie 中的令牌签名与时效
 *   - 登出时清除 Cookie
 *
 * 通过 context.request.url 解析原始请求路径来路由不同端点。
 * 对于需要完整 Node.js 运行时（音乐 SDK、文件系统等）的端点，
 * 返回明确的错误信息，让前端可以优雅降级。
 */

// ===== Constants =====
const SESSION_COOKIE_NAME = 'lx_player_session'
const SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24 小时，与原服务器一致
const SESSION_TTL_S = 86400

// ===== HMAC helpers (Web Crypto API) =====
const encoder = new TextEncoder()

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function hmacVerify(data: string, hexSig: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const sigBytes = new Uint8Array(hexSig.match(/.{2}/g)!.map(h => parseInt(h, 16)))
  return crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(data))
}

// ===== Cookie parser =====
function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {}
  return Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [k, ...v] = c.trim().split('=')
      return [k.trim(), decodeURIComponent(v.join('='))]
    }),
  )
}

// ===== Session token =====
function getSessionSecret(env: any): string {
  // SESSION_SECRET 优先；否则用 WEBPLAYER_PASSWORD 派生
  return env.SESSION_SECRET || env.WEBPLAYER_PASSWORD || '123456'
}

async function createSessionToken(secret: string): Promise<string> {
  const ts = Date.now().toString()
  const sig = await hmacSign(ts, secret)
  return `${ts}.${sig}`
}

async function verifySessionToken(token: string, secret: string): Promise<boolean> {
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [ts, sig] = parts
  // 检查时效
  const timestamp = parseInt(ts, 10)
  if (isNaN(timestamp) || Date.now() - timestamp > SESSION_TTL_MS) return false
  // 检查签名
  return hmacVerify(ts, sig, secret)
}

// ===== JSON response helper =====
function jsonResponse(body: any, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      ...extraHeaders,
    },
  })
}

// ===== 静态歌单排序选项（来源于各平台 musicSdk songList.sortList 常量）=====
const SONG_LIST_SORT_LISTS: Record<string, { name: string; id: string | number }[]> = {
  wy: [{ name: '最热', id: 'hot' }],
  kg: [{ name: '推荐', id: '5' }, { name: '最热', id: '6' }, { name: '最新', id: '7' }],
  tx: [{ name: '最热', id: 5 }, { name: '最新', id: 2 }],
  kw: [{ name: '最新', id: 'new' }, { name: '最热', id: 'hot' }],
  mg: [{ name: '推荐', id: '15127315' }],
  bd: [{ name: '最热', id: '1' }, { name: '最新', id: '0' }],
}

// ===== Route dispatcher =====
export async function onRequest(context: any) {
  const req = context.request
  const url = new URL(req.url)
  const pathname = url.pathname
  const method = req.method
  const searchParams = url.searchParams

  // 从 env 读取配置
  const playerPassword = context.env.WEBPLAYER_PASSWORD || '123456'
  const enableAuth = context.env.ENABLE_WEBPLAYER_AUTH === 'true'
  const enablePublicRestriction = context.env.ENABLE_PUBLIC_USER_RESTRICTION !== 'false'
  const secret = getSessionSecret(context.env)

  // ----- GET /api/music/config -----
  if (pathname === '/api/music/config' && method === 'GET') {
    return jsonResponse({
      'player.enableAuth': enableAuth,
      'user.enablePublicRestriction': enablePublicRestriction,
    })
  }

  // ----- POST /api/music/auth -----
  if (pathname === '/api/music/auth' && method === 'POST') {
    try {
      const body = await req.json()
      const { password } = body

      if (password === playerPassword) {
        const token = await createSessionToken(secret)
        const setCookie = `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_TTL_S}`
        return jsonResponse({ success: true }, 200, { 'Set-Cookie': setCookie })
      } else {
        return jsonResponse({ success: false })
      }
    } catch (e) {
      return jsonResponse({ success: false, error: 'Bad Request' }, 400)
    }
  }

  // ----- GET /api/music/auth/verify -----
  if (pathname === '/api/music/auth/verify' && method === 'GET') {
    const cookies = parseCookies(req.headers.get('cookie'))
    const token = cookies[SESSION_COOKIE_NAME]
    if (!token) {
      return jsonResponse({ valid: false })
    }
    const valid = await verifySessionToken(token, secret)
    return jsonResponse({ valid })
  }

  // ----- POST /api/music/auth/logout -----
  if (pathname === '/api/music/auth/logout' && method === 'POST') {
    const clearCookie = `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`
    return jsonResponse({ success: true }, 200, { 'Set-Cookie': clearCookie })
  }

  // ===== 歌单/排行榜/歌手等端点：静态部署模式下无法调用 musicSdk =====
  // 策略：返回前端期望格式的空数据（而非 503），让 UI 显示"暂无数据"而不崩溃。
  // 对于 songList/tags，sortList 是各平台静态常量，可以硬编码返回。

  // ----- GET /api/music/songList/tags -----
  // 前端期望: { tags: [], hotTags: [], sortList: [...] }
  // sortList 来源于各 SDK 的静态常量，可硬编码；tags/hotTags 需动态获取，返回空数组
  if (pathname === '/api/music/songList/tags' && method === 'GET') {
    const source = searchParams.get('source') || 'wy'
    return jsonResponse({
      tags: [],
      hotTags: [],
      sortList: SONG_LIST_SORT_LISTS[source] || SONG_LIST_SORT_LISTS['wy'],
    })
  }

  // ----- GET /api/music/songList/list -----
  // 前端期望: { list: [], total: 0, limit: 30 }
  if (pathname === '/api/music/songList/list' && method === 'GET') {
    return jsonResponse({ list: [], total: 0, limit: 30 })
  }

  // ----- GET /api/music/songList/detail -----
  // 前端期望: { info: null, list: [], total: 0 }
  if (pathname === '/api/music/songList/detail' && method === 'GET') {
    return jsonResponse({ info: null, list: [], total: 0 })
  }

  // ----- GET /api/music/songList/search -----
  // 前端期望: { list: [], total: 0, limit: 20 }
  if (pathname === '/api/music/songList/search' && method === 'GET') {
    return jsonResponse({ list: [], total: 0, limit: 20 })
  }

  // ----- GET /api/music/songList/userPlaylist -----
  // 前端期望: { list: [], nickname: '', avatar: '' }
  if (pathname === '/api/music/songList/userPlaylist' && method === 'GET') {
    return jsonResponse({ list: [], nickname: '', avatar: '' })
  }

  // ----- GET /api/music/leaderboard/boards -----
  // 前端期望: { list: [] }
  if (pathname === '/api/music/leaderboard/boards' && method === 'GET') {
    return jsonResponse({ list: [] })
  }

  // ----- GET /api/music/leaderboard/list -----
  // 前端期望: { list: [], total: 0, limit: 100 }
  if (pathname === '/api/music/leaderboard/list' && method === 'GET') {
    return jsonResponse({ list: [], total: 0, limit: 100 })
  }

  // ----- GET /api/music/hotSearch -----
  // 前端期望: { list: [], source: 'mg' }
  if (pathname === '/api/music/hotSearch' && method === 'GET') {
    const source = searchParams.get('source') || 'mg'
    return jsonResponse({ list: [], source })
  }

  // ----- GET /api/music/artistDetail -----
  // 前端期望: { info: null, list: [] }
  if (pathname === '/api/music/artistDetail' && method === 'GET') {
    return jsonResponse({ info: null, list: [] })
  }

  // ----- GET /api/music/artistAlbums -----
  // 前端期望: { list: [], total: 0 }
  if (pathname === '/api/music/artistAlbums' && method === 'GET') {
    return jsonResponse({ list: [], total: 0 })
  }

  // ----- GET /api/music/artistSongs -----
  // 前端期望: { list: [], total: 0 }
  if (pathname === '/api/music/artistSongs' && method === 'GET') {
    return jsonResponse({ list: [], total: 0 })
  }

  // ----- GET /api/music/albumSongs -----
  // 前端期望: { list: [], total: 0 }
  if (pathname === '/api/music/albumSongs' && method === 'GET') {
    return jsonResponse({ list: [], total: 0 })
  }

  // ----- 以下端点确实无法提供有意义的数据，保持 503 -----

  // /api/music/url - 音乐 URL 解析（需要 musicSdk + VM 沙箱）
  if (pathname === '/api/music/url') {
    return jsonResponse({
      error: '此端点需要完整服务器运行时（音乐 SDK + 自定义源沙箱），静态部署模式下不可用。',
      code: 503,
      endpoint: pathname,
    }, 503)
  }

  // /api/music/search - 音乐搜索（需要 musicSdk）
  if (pathname === '/api/music/search') {
    return jsonResponse({
      error: '此端点需要完整服务器运行时（音乐 SDK），静态部署模式下不可用。',
      code: 503,
      endpoint: pathname,
    }, 503)
  }

  // /api/music/lyric - 歌词获取（需要 musicSdk + 文件系统）
  if (pathname === '/api/music/lyric') {
    return jsonResponse({
      error: '此端点需要完整服务器运行时（音乐 SDK + 文件缓存），静态部署模式下不可用。',
      code: 503,
      endpoint: pathname,
    }, 503)
  }

  // /api/music/download - 下载代理（需要 HTTP 代理 + 文件系统）
  if (pathname === '/api/music/download') {
    return jsonResponse({
      error: '此端点需要完整服务器运行时（下载代理 + 元数据嵌入），静态部署模式下不可用。',
      code: 503,
      endpoint: pathname,
    }, 503)
  }

  // /api/music/tipSearch - 搜索提示（需要 musicSdk）
  if (pathname === '/api/music/tipSearch') {
    return jsonResponse([], 200) // 前端期望数组，返回空数组避免报错
  }

  // /api/music/progress - SSE 进度推送（需要服务器内存状态）
  if (pathname === '/api/music/progress') {
    return jsonResponse({
      error: '此端点需要完整服务器运行时（SSE + 内存状态），静态部署模式下不可用。',
      code: 503,
      endpoint: pathname,
    }, 503)
  }

  // /api/music/cache/* - 缓存相关（需要文件系统）
  if (pathname.startsWith('/api/music/cache/')) {
    return jsonResponse({
      error: '此端点需要完整服务器运行时（文件缓存系统），静态部署模式下不可用。',
      code: 503,
      endpoint: pathname,
    }, 503)
  }

  // /api/music/identify - 音频识别（需要 AcoustID + 文件系统）
  if (pathname === '/api/music/identify') {
    return jsonResponse({
      error: '此端点需要完整服务器运行时（音频识别服务），静态部署模式下不可用。',
      code: 503,
      endpoint: pathname,
    }, 503)
  }

  // /api/music/user/list/* - 用户列表操作（需要用户数据系统）
  if (pathname.startsWith('/api/music/user/list/')) {
    return jsonResponse({
      error: '此端点需要完整服务器运行时（用户数据管理），静态部署模式下不可用。',
      code: 503,
      endpoint: pathname,
    }, 503)
  }

  // ----- Fallback: unknown /api/music/* endpoint -----
  return jsonResponse({
    error: '未知的音乐 API 端点',
    code: 404,
    endpoint: pathname,
  }, 404)
}
