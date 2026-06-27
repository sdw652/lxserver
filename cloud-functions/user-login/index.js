exports.handler = async (context) => {
  const body = context.request.body
  let username = ''
  let password = ''
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body
    username = parsed.username || ''
    password = parsed.password || ''
  } catch (e) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, message: 'Missing username or password' })
    }
  }

  if (!username || !password) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, message: 'Missing username or password' })
    }
  }

  // Parse users from LX_USER_<name> env vars or USER_JSON env var
  let users = []
  const userJson = context.env.USER_JSON
  if (userJson) {
    try {
      users = JSON.parse(userJson)
    } catch (e) {}
  }
  // Also check LX_USER_ prefix env vars
  for (const [key, val] of Object.entries(context.env)) {
    if (key.startsWith('LX_USER_') && val) {
      const name = key.replace('LX_USER_', '')
      users.push({ name, password: val })
    }
  }

  const user = users.find(u => u.name === username && u.password === password)
  if (user) {
    // Generate a simple token
    const token = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, token, username })
    }
  } else {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, message: 'Invalid credentials' })
    }
  }
}
