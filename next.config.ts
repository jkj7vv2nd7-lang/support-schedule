import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PDF出力の日本語フォントをVercel本番の関数バンドルに同梱する
  outputFileTracingIncludes: {
    "/api/export": ["./assets/fonts/**/*"],
  },
  // 基本的なセキュリティヘッダ（埋め込み悪用・MIME偽装の抑止）
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
