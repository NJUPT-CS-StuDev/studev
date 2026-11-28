# studev.hicancan.top after the move to studev.cn

A person who opens an old address in a browser sees a short note that StuDev has moved, then lands on the same page
at `studev.cn`. Everything else, an app's update check, a data download, an API call, gets a 301 to the same path on
`studev.cn` or `data.studev.cn` (Redirect Rules in the `hicancan.top` zone; a page navigation is told apart by its
`Sec-Fetch-Mode: navigate` header). The note and `/sw.js` come from the Cloudflare Pages project `studev-legacy`, built
from this folder; the worker removes the old site's offline copy from browsers that installed it and sends their pages
to `studev.cn`.

An Android app from before the move asks the old site for `app-release.json` (as `studev-android`). It gets this
folder's copy: a newer version and a data entry it cannot read, which is the condition under which that app shows its
full-screen "download the new version" page; the download button opens the old address in the browser, where the note
about the move leads to `studev.cn/download/`. A Windows app updates itself from `dl.hicancan.top`, which did not move.

Deploy: `npx wrangler pages deploy legacy --project-name studev-legacy`.
