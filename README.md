# StuDev

StuDev 是南京邮电大学计算机学院、软件学院、网络空间安全学院学生发展中心维护的公开网站。

网站：https://studev.hicancan.top/

GitHub 组织：https://github.com/NJUPT-CS-StuDev

技术栈：Astro、Markdown、EdgeOne Static Hosting。

`src/content/` 中，Study、Develop、Life、History、About 各有一份 Markdown 内容；`src/pages/` 提供对应路由。首页不展示文章流。

```powershell
npm install
npm run astro -- dev --background
npm run build
```

开发结束后运行 `npm run astro -- dev stop`。
