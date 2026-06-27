/**
 * Cloud Function: /api/* (catch-all)
 *
 * 处理所有未被更具体路由（/api/login、/api/music/*）匹配的 /api/* 请求。
 * 这些端点大多数需要完整的 Node.js 运行时（文件系统、用户管理、数据持久化等），
 * 在静态部署模式下无法实现。
 *
 * 返回明确的 503 错误信息，让前端可以优雅降级或提示用户
 * 需要使用完整服务器模式才能使用这些功能。
 */

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

export async function onRequest(context: any) {
  const req = context.request
  const url = new URL(req.url)
  const pathname = url.pathname
  const method = req.method

  // ----- /api/status - 服务器状态（需要 os 模块 + 进程信息）-----
  if (pathname === '/api/status') {
    return jsonResponse({
      error: '此端点需要完整服务器运行时（系统监控），静态部署模式下不可用。',
      code: 503,
      endpoint: pathname,
    }, 503)
  }

  // ----- /api/users - 用户管理（需要文件系统 + 内存状态）-----
  if (pathname === '/api/users') {
    return jsonResponse({
      error: '此端点需要完整服务器运行时（用户管理），静态部署模式下不可用。',
      code: 503,
      endpoint: pathname,
    }, 503)
  }

  // ----- /api/data/* - 数据/快照管理（需要文件系统 + 用户空间）-----
  if (pathname.startsWith('/api/data')) {
    return jsonResponse({
      error: '此端点需要完整服务器运行时（数据管理 + 快照系统），静态部署模式下不可用。',
      code: 503,
      endpoint: pathname,
    }, 503)
  }

  // ----- /api/user/* - 用户认证/设置/Token（需要文件系统 + 内存状态）-----
  if (pathname.startsWith('/api/user/')) {
    // /api/user/verify - 用户密码验证
    if (pathname === '/api/user/verify' && method === 'POST') {
      return jsonResponse({
        success: false,
        message: '此端点需要完整服务器运行时（用户认证系统），静态部署模式下不可用。',
      }, 503)
    }
    // /api/user/login - 用户登录颁发 Token
    if (pathname === '/api/user/login' && method === 'POST') {
      return jsonResponse({
        success: false,
        message: '此端点需要完整服务器运行时（用户认证系统），静态部署模式下不可用。',
      }, 503)
    }
    // /api/user/logout - 用户登出
    if (pathname === '/api/user/logout' && method === 'POST') {
      return jsonResponse({ success: true }) // 登出无需服务器状态，直接返回成功
    }
    // /api/user/auth/verify - Token 验证
    if (pathname === '/api/user/auth/verify' && method === 'GET') {
      return jsonResponse({ valid: false }) // 无服务器状态，Token 一定无效
    }
    // /api/user/list - 用户列表数据
    if (pathname === '/api/user/list') {
      return jsonResponse({
        error: '此端点需要完整服务器运行时（用户数据管理），静态部署模式下不可用。',
        code: 503,
        endpoint: pathname,
      }, 503)
    }
    // /api/user/library/* - 收藏歌手/专辑
    if (pathname.startsWith('/api/user/library/')) {
      return jsonResponse({
        error: '此端点需要完整服务器运行时（用户收藏库），静态部署模式下不可用。',
        code: 503,
        endpoint: pathname,
      }, 503)
    }
    // /api/user/settings - 用户设置
    if (pathname === '/api/user/settings') {
      return jsonResponse({
        error: '此端点需要完整服务器运行时（用户设置持久化），静态部署模式下不可用。',
        code: 503,
        endpoint: pathname,
      }, 503)
    }
    // /api/user/sound-effects - 音效设置
    if (pathname === '/api/user/sound-effects') {
      return jsonResponse({
        error: '此端点需要完整服务器运行时（用户音效设置），静态部署模式下不可用。',
        code: 503,
        endpoint: pathname,
      }, 503)
    }
    // /api/user/token/* - Token 管理
    if (pathname.startsWith('/api/user/token/')) {
      return jsonResponse({
        error: '此端点需要完整服务器运行时（Token 管理系统），静态部署模式下不可用。',
        code: 503,
        endpoint: pathname,
      }, 503)
    }
    // 其他 /api/user/* 端点
    return jsonResponse({
      error: '此端点需要完整服务器运行时（用户系统），静态部署模式下不可用。',
      code: 503,
      endpoint: pathname,
    }, 503)
  }

  // ----- Fallback: unknown /api/* endpoint -----
  return jsonResponse({
    error: '未知的 API 端点',
    code: 404,
    endpoint: pathname,
  }, 404)
}
