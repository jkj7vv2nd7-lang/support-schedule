import type { MetadataRoute } from "next";

// 公開URLが分かる場合のみサイトマップを出す（未設定時は空にして無効な相対URLを出さない）
export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  if (!base) return [];
  const now = new Date();
  return ["", "/classes", "/people", "/weeks"].map((p) => ({
    url: `${base}${p || "/"}`,
    lastModified: now,
  }));
}
