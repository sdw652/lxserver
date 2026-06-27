export async function onRequest(context: any) {
  // 从环境变量读取配置，替代原 Node.js 服务器对 /js/config.js 的动态注入
  const frontendConfig = {
    version: 'v1.9.4',
    buildHash: 'c95106b',
    serverName: context.env.SERVER_NAME || 'lxserver',
    disableTelemetry: context.env.DISABLE_TELEMETRY === 'true',
    'proxy.enabled': context.env.PROXY_HEADER ? true : false,
    'proxy.header': context.env.PROXY_HEADER || 'x-real-ip',
    'user.enablePath': context.env.USER_ENABLE_PATH !== 'false',
    'user.enableRoot': context.env.USER_ENABLE_ROOT === 'true',
    'user.enablePublicRestriction': context.env.ENABLE_PUBLIC_USER_RESTRICTION !== 'false',
    'user.enableLoginCacheRestriction': context.env.ENABLE_LOGIN_USER_CACHE_RESTRICTION === 'true',
    'user.enableCacheSizeLimit': context.env.ENABLE_CACHE_SIZE_LIMIT === 'true',
    'user.cacheSizeLimit': parseInt(context.env.CACHE_SIZE_LIMIT || '2000', 10),
    maxSnapshotNum: parseInt(context.env.MAX_SNAPSHOT_NUM || '10', 10),
    'list.addMusicLocationType': context.env.LIST_ADD_MUSIC_LOCATION_TYPE || 'top',
    'player.enableAuth': context.env.ENABLE_WEBPLAYER_AUTH === 'true',
    port: parseInt(context.env.PORT || '9527', 10),
    bindIP: context.env.BIND_IP || '0.0.0.0',
    'admin.path': context.env.ADMIN_PATH || '',
    'player.path': context.env.PLAYER_PATH || '/music',
  }

  const jsContent = `window.CONFIG = ${JSON.stringify(frontendConfig, null, 2)};`

  return new Response(jsContent, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  })
}
