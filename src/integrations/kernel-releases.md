# 发布内核再部署网页

网页依赖公开、不可变的 GitHub release 附件，不依赖本机目录。

协调者先合入并推送内核改动，再打标签：

- `hicancan/wayfind`：`web-release` 的发布工作流，标签 `v0.1.0`。
- `hicancan/wasm-search`：`pinyin` 的内核改动，标签 `v1.0.3`。

等待两个 release 工作流成功产生附件后，studev 才能在干净环境中执行 `npm ci`。
拼音索引改变了打包产物，部署时也应选用一个新的 njupt-data release 标签，
不要覆盖当前已上线的 `/data/<version>/`；旧 URL 的浏览器/CDN 缓存是永久的。
已发布附件不替换；后续修改递增版本。当前 lockfile 不给尚未发布的附件预填本机构建的
integrity；发布后可用 `npm install --package-lock-only` 记录实际附件校验值。

发布前，本地已编译的两个包可这样临时安装，保持提交中的 URL 和 lockfile 不变：

```powershell
npm install --no-save --package-lock=false D:/Temp/codex/web-parity/wasm-search-1.0.3.tgz D:/Temp/codex/web-parity/wayfind-0.1.0.tgz
```

临时包不属于仓库交付物，协调者可在两个内核 worktree 中分别执行
`npm ci --prefix js`、`npm run build --prefix js`，再从 `js/` 执行
`npm pack --ignore-scripts --pack-destination <临时目录>` 重建。

`npm run digest` 先生成地图样式、字体与图标，再打包校园数据与拼音搜索索引。
`npm run build` 也走同一路径，因此全新 CI 检出不会缺少 ignored 的地图资源。
npm 的 `allowScripts` 同时批准 Puppeteer 的浏览器安装脚本，内容页的静态 Mermaid
在干净 CI 中也有可用的渲染器。本机浏览器缓存不完整时，可以仅在当前进程设置
`PUPPETEER_EXECUTABLE_PATH` 指向已安装的 Chrome，再执行检查与构建。

部署配置的 `Permissions-Policy` 目前包含 `geolocation=()`，协调者需要将其改为
`geolocation=(self)` 才能在生产网页使用浏览器定位。此配置不在 web-parity 所有权内。
