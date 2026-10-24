import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SearchStatus } from "@/search/ui/SearchStatus";
import { SearchSection } from "@/search/ui/SearchSection";
import { resultSummary } from "@/search/ui/searchLabels";
import { HomePage } from "@/home/HomePage";
import { SearchInput } from "@/shared/ui/SearchInput";
import { SEARCH_SCOPES } from "@/search/searchScopes";

describe("product copy contract", () => {
  it("describes search results without exposing ranking internals", () => {
    expect(resultSummary({}, 10, 180)).toBe(
      "找到 180 条相关结果，已显示前 10 条。",
    );
    expect(resultSummary({ sourceId: "source-a" }, 9, 9)).toBe(
      "筛选后找到 9 条相关结果。",
    );

    const status = renderToStaticMarkup(
      <SearchStatus documentCount={22052} statusText="找到 180 条相关结果。" />,
    );
    expect(status).toContain("已收录 22,052 条信息");
    expect(status).not.toContain("候选");
    expect(status).not.toContain("语料");
  });

  it("makes loading and empty search states clear and actionable", () => {
    const baseProps = {
      documentCount: 22052,
      response: null,
      sortMode: "relevance" as const,
      datePreset: "all" as const,
      filterOptions: null,
      scope: SEARCH_SCOPES.search,
      canLoadMore: false,
      onSortModeChange: () => undefined,
      onFiltersChange: () => undefined,
      onScopeChange: () => undefined,
      onDatePresetChange: () => undefined,
      onLoadMore: () => undefined,
    };
    const loading = renderToStaticMarkup(
      <SearchSection {...baseProps} query="肖甫" searching filters={{}} />,
    );
    const empty = renderToStaticMarkup(
      <SearchSection
        {...baseProps}
        query="肖甫"
        searching={false}
        filters={{}}
      />,
    );
    const filteredEmpty = renderToStaticMarkup(
      <SearchSection
        {...baseProps}
        query="肖甫"
        searching={false}
        filters={{ sourceId: "scie" }}
      />,
    );

    expect(loading).toContain("正在搜索…");
    expect(loading).not.toMatch(/倒排索引|正文块/);
    expect(empty).toContain("没有找到相关结果。");
    expect(empty).toContain("换个关键词试试。");
    expect(filteredEmpty).toContain("没有符合筛选条件的结果。");
    expect(filteredEmpty).toContain("减少筛选条件后再试。");
  });

  it("keeps the home page focused on search without a subtitle", () => {
    const html = renderToStaticMarkup(
      <HomePage
        inputValue=""
        onQuickSearch={() => undefined}
        onInputChange={() => undefined}
        onSubmit={() => undefined}
        onSearchWarm={() => undefined}
        onIntentWarm={() => undefined}
      />,
    );
    expect(html).toContain("studev");
    expect(html).toContain("教务查询");
    expect(html).toContain("社区搜索");
    expect(html).toContain("资料搜索");
    expect(html).toContain("南邮生存手册");
    expect(html).toContain("历年课程资料");
    expect(html).not.toContain("日常教学");
    expect(html).not.toMatch(/>考试<\/h2>/);
    expect(html).not.toContain("南邮通知、考试安排和考试教室，都可以直接查。");
  });

  it("offers an explicit accessible search submission action", () => {
    const html = renderToStaticMarkup(
      <SearchInput
        value="B240402"
        onChange={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    expect(html).toContain('type="submit"');
    expect(html).toContain('aria-label="提交搜索"');
  });
});
