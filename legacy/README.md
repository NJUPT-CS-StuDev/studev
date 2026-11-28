# studev.hicancan.top after the move to studev.cn

Cloudflare answers every request to `studev.hicancan.top` and `data.hicancan.top` with a 301 to the same path on
`studev.cn` and `data.studev.cn` (Redirect Rules in the `hicancan.top` zone), except `/sw.js` on the old site. That
path is served from the Cloudflare Pages project `studev-legacy`, built from this folder: a worker that removes the
site's old offline copy from browsers that installed it, then sends their pages to `studev.cn`.

Old Android and Windows apps keep working for reads (an update check or data download follows the redirect) and are
told to update when they sign in or submit, which do not follow redirects.

Deploy: `npx wrangler pages deploy legacy --project-name studev-legacy`.
