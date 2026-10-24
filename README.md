# StuDev

南京邮电大学计算机学院、软件学院、网络空间安全学院学生发展中心。

[网站](https://studev.hicancan.top/) · [GitHub](https://github.com/NJUPT-CS-StuDev)

## 校园查询

`/search/` 下的搜索、班级课表、考试安排和空闲教室，数据来自
[campus-data](https://github.com/<data-repository>) 的最新 Release，由本仓库“消化”成网站使用的形态：

```text
campus-data release ──scripts/digest.ts──► public/data/<版本>/{search,timetable,exams,classrooms}
                        campus.config.ts（搜索同义词、分类规则、教室判定）
```

- 全文检索由 [wasm-search](https://github.com/hicancan/wasm-search) 完成：构建时在 Node 中编译索引，浏览器里由同一个 WASM 查询。
- 界面是 `src/campus/` 下的 React 应用，作为 Astro island 挂在 `src/pages/search/*`；站点页头的搜索框就是它的搜索框。

```powershell
npm run digest        # 下载最新数据并消化；本地调试可设 DATA_DIR 指向 campus-data/out
npm run test:campus
npm run build         # digest + 构建
```

技术栈：Astro 7、React 19（islands）、TypeScript、Tailwind CSS 4、Vitest。
