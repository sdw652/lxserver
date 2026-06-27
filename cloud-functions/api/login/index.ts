/**
 * Cloud Function: /api/login
 *
 * 替代原 Node.js 服务器对 /api/login 的处理。
 * 管理控制台登录验证：将前端提交的密码与 FRONTEND_PASSWORD 环境变量比对，
 * 返回 {success: true/false}。
 *
 * 原服务器对错误密码返回 401，但前端 request() 方法在收到 401 时会强制 logout 并刷新页面，
 * 导致用户无法看到"密码错误"提示。此处改为对错误密码返回 200 + {success: false}，
 * 让前端 login() 正常进入 else 分支显示"密码错误"，改善用户体验。
 */
export async function onRequestPost(context: any) {
  try {
    const body = await context.request.json()
    const { password } = body

    const frontendPassword = context.env.FRONTEND_PASSWORD || '123456'

    if (password === frontendPassword) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      })
    } else {
      // 返回 200 + success:false，避免前端 request() 的 401 自动 logout 逻辑
      return new Response(JSON.stringify({ success: false }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      })
    }
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: 'Bad Request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  }
}
