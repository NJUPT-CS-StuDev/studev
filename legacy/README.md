# Retired addresses

`njupt.hicancan.top` and `studev.hicancan.top` are StuDev's earlier addresses, `data.hicancan.top` its earlier data
host. All of them now answer with a 301 (Redirect Rules in the `hicancan.top` zone):

- a page visit (`Sec-Fetch-Mode: navigate`) goes to `studev.cn/moved/<old host><path>`, the site's moving-day page
  (`src/pages/moved.astro`). It names the old address, counts down and opens the same page on `studev.cn`;
- anything else on a site address goes to the same path on `studev.cn`, and everything on the data host to the same
  path on `data.studev.cn`.

Three files have to come from the old addresses themselves, so they are served from this folder by the Cloudflare
Pages project `studev-legacy`:

- `sw.js`: a browser that installed the old site keeps answering its pages from that site's offline worker, and the
  only request it still sends is the worker's own update check, which may not be redirected. This worker clears the
  old copy, unregisters and reloads the open pages, whose visits then reach the redirect.
- `app-release.json` and `campus-release.json`, for an Android app from before the move (it asks as `studev-android`
  and follows redirects, so the new site's files would keep it running). These give it a newer version and a data
  entry it cannot read, the condition under which it shows its full-screen "download the new version" page; the
  download button opens the old address in the browser, which leads through the moving-day page to
  `studev.cn/download/`. A Windows app updates itself from `dl.hicancan.top`, which did not move.

Retiring another address: point it at `studev-legacy`, add it to the two site rules and to `RETIRED` in
`src/pages/moved.astro`.

Deploy: `npx wrangler pages deploy legacy --project-name studev-legacy`.
