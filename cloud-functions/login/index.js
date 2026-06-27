exports.handler = async (context) => {
  const body = context.request.body
  let password = ''
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body
    password = parsed.password || ''
  } catch (e) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, message: 'Bad Request' })
    }
  }

  const frontendPassword = context.env.FRONTEND_PASSWORD || '123456'

  if (password === frontendPassword) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true })
    }
  } else {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false })
    }
  }
}
