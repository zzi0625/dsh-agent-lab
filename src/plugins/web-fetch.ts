/**
 * plugins/web-fetch.ts — web-fetch 插件
 * 抓取指定 URL 的网页，去掉脚本、样式和标签，只返回正文纯文本（截断到 2000 字）。
 * 模型在 web-search 拿到链接后，用它读取页面细节。
 */

import type { ToolPlugin } from "./types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const MAX_TEXT = 2000;

function stripPage(html: string): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

export const webFetchPlugin: ToolPlugin = {
  name: "web-fetch",
  description: "抓取指定网页 URL 的正文内容，返回纯文本。搜索到具体链接后，用它读取页面详情。",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "要抓取的完整网页地址" },
    },
    required: ["url"],
  },

  async execute(args) {
    const url = String(args.url ?? "").trim();
    if (!url) return "[error] 缺少 url 参数";
    if (!/^https?:\/\//.test(url)) return "[error] url 必须以 http:// 或 https:// 开头";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!resp.ok) {
        return `[error] 页面抓取失败，HTTP ${resp.status}`;
      }

      const html = await resp.text();
      const text = stripPage(html);
      if (!text) return "页面没有解析出正文内容。";
      return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…(正文已截断)` : text;
    } catch (err) {
      return `[error] 页面抓取超时或失败：${err instanceof Error ? err.message : String(err)}`;
    } finally {
      clearTimeout(timer);
    }
  },
};
