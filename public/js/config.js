// 此文件为兜底默认值
// 当 cloud-function 不可用时，前端仍可加载基础配置避免崩溃
// 正常情况下由 cloud-function 动态注入完整配置
window.CONFIG = window.CONFIG || {
    buildHash: 'c95106b',
    version: 'v1.9.4',
    serverName: 'lxserver',
    disableTelemetry: false,
    'proxy.enabled': false,
    'proxy.header': 'x-real-ip',
    'user.enablePath': true,
    'user.enableRoot': false,
    'user.enablePublicRestriction': true,
    'user.enableLoginCacheRestriction': false,
    'user.enableCacheSizeLimit': false,
    'user.cacheSizeLimit': 2000,
    maxSnapshotNum: 10,
    'list.addMusicLocationType': 'top',
    'player.enableAuth': false,
    port: 9527,
    bindIP: '0.0.0.0',
    'admin.path': '',
    'player.path': '/music',
};
