import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PDF出力の日本語フォントをVercel本番の関数バンドルに同梱する
  outputFileTracingIncludes: {
    "/api/export": ["./assets/fonts/**/*"],
  },
};

export default nextConfig;
