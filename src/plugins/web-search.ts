/**
 * plugins/web-search.ts — web-search 插件（实验四核心工具）
 * 免费搜索后端：Bing 中文搜索页（无需第三方 API 密钥）。
 * 输入关键词，解析页面上的结果条目，返回标题 / 链接 / 摘要列表。
 */

import type { ToolPlugin } from "./types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const BING_URL = "https://cn.bing.com/search";

/** 解码常见 HTML 实体，并去掉标签 */
function cleanHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;|&#160;|&ensp;|&emsp;/g, " ")
    .replace(/&middot;/g, "·")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

/** 从 Bing 结果页 HTML 里抠出搜索结果 */
function parseBing(html: string): SearchResult[] {
  const blocks = html.split(/<li\s+class="b_algo"/).slice(1);
  const results: SearchResult[] = [];

  for (const block of blocks) {
    const titleMatch = block.match(/<h2>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;

    const link = titleMatch[1];
    const title = cleanHtml(titleMatch[2]);
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const snippet = snippetMatch ? cleanHtml(snippetMatch[1]) : "";

    if (title && link) results.push({ title, link, snippet });
  }
  return results;
}

export const webSearchPlugin: ToolPlugin = {
  name: "web-search",
  description: "在 Bing 上搜索关键词，返回若干条网页结果（标题、链接、摘要）。需要查最新信息或资料时使用。",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索关键词" },
      count: { type: "number", description: "返回结果条数，默认 5" },
    },
    required: ["query"],
  },

  async execute(args) {
    const query = String(args.query ?? "").trim();
    if (!query) return "[error] 缺少 query 参数";
    const count = Math.min(Math.max(Number(args.count ?? 5) || 5, 1), 10);

    const url = `${BING_URL}?q=${encodeURIComponent(query)}&count=${count}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" },
    });
    if (!resp.ok) {
      return `[error] 搜索请求失败，HTTP ${resp.status}`;
    }

    const html = await resp.text();
    const results = parseBing(html).slice(0, count);
    if (results.length === 0) {
      return `未搜到与「${query}」相关的结果。`;
    }

    return results
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.link}\n   ${r.snippet || "(无摘要)"}`)
      .join("\n\n");
  },
};
