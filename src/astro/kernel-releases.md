# 内核发布与网页依赖

网页只依赖公开、不可变的 GitHub release 附件，不依赖本机目录：

| 包 | 来源 | 版本 |
| --- | --- | --- |
| `wayfind` | `hicancan/wayfind` release `v0.1.0` 的 `wayfind-0.1.0.tgz` | 0.1.0 |
| `wasm-search` | `hicancan/wasm-search` release `v1.0.3` 的 `wasm-search-1.0.3.tgz` | 1.0.3 |

`package-lock.json` 记录两个附件的实际 sha512 integrity，干净检出直接 `npm ci`。
已发布附件不替换；内核修改时在内核仓库递增版本、发布新附件，再更新 `package.json`
中的 URL 并执行 `npm install --package-lock-only` 记录新的 integrity。
改变打包产物的内核升级应配合一个新的 njupt-data release 标签部署，不覆盖已上线的
`/data/<version>/`；旧 URL 的浏览器/CDN 缓存是永久的。

`npm run digest` 先生成地图样式、字体与图标，再打包校园数据与拼音搜索索引。
数据 release 必须包含校园空间及完整地图文件；缺失时打包立即失败，不部署残缺地图。
`npm run build` 也走同一路径，因此全新 CI 检出不会缺少 ignored 的地图资源。
npm 的 `allowScripts` 同时批准 Puppeteer 的浏览器安装脚本，内容页的静态 Mermaid
在干净 CI 中也有可用的渲染器。本机浏览器缓存不完整时，可以仅在当前进程设置
`PUPPETEER_EXECUTABLE_PATH` 指向已安装的 Chrome，再执行检查与构建。

部署配置的 `Permissions-Policy` 为 `geolocation=(self)`；`/sw.js` 和
`/pwa-release.json` 使用 `Cache-Control: no-cache`，让边缘节点及时重新验证更新入口；
版本化的 `/data/*` 永久缓存。
