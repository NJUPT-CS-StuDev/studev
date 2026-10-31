# StuDev

南京邮电大学计算机学院、软件学院、网络空间安全学院学生发展中心。

[网站](https://studev.hicancan.top/) · [GitHub](https://github.com/NJUPT-CS-StuDev)

`/search/` 下的校园查询是 `src/campus/` 中的 React 应用；`scripts/data/digest.ts` 原样打包 njupt-data 的事实，按班级分片并生成搜索包，
`campus.config.ts` 决定怎么呈现。全文检索由 [wasm-search](https://github.com/hicancan/wasm-search) 完成。

```powershell
npm run digest
npm run test:campus
npm run build
```

技术栈：Astro 7、React 19（islands）、TypeScript、Tailwind CSS 4、Vitest。
