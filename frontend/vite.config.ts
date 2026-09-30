import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode })=> {
  const env = loadEnv(mode, process.cwd(), "");

  const apiProxyTarget =
    env.VITE_DEV_API_PROXY_TARGET || "http://127.0.0.1:3000";

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: "auto",
        includeAssets: ["logo.png", "favicon.ico"],
        manifest: {
          name: "TubeKeter AI Analytics",
          short_name: "TubeKeter",
          description:
            "Professional web app to fetch, analyze and export YouTube channel & playlist video metadata.",
          theme_color: "#0f0f0f",
          background_color: "#0f0f0f",
          display: "standalone",
          start_url: "/",
          scope: "/",
          icons: [
            {
              src: "pwa-icon-192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "pwa-icon-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "pwa-icon-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2}"],
          navigateFallback: "/index.html",
          // Never cache OAuth callback or API traffic.
          // NOTE: denylist regexes are tested against pathname + search,
          // so no `$` anchor — /oauth-callback.html?code=... must match too.
          navigateFallbackDenylist: [/^\/oauth-callback\.html/, /^\/api\//],
          runtimeCaching: [
            {
              urlPattern: /\/api\//,
              handler: "NetworkFirst",
              options: {
                cacheName: "api-cache",
                networkTimeoutSeconds: 10,
                expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
        devOptions: { enabled: false },
      }),
    ],

    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },

    // NOTE: keep `console` (not stripped) — OAuth flow logs diagnostics in prod.
    esbuild: {
      drop: mode === "production" ? ["debugger"] : [],
    },

    server: {
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },

    build: {
      minify: "esbuild",

      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes("node_modules")) {
              if (
                /[\\/]react[\\/]|[\\/]react-dom[\\/]|[\\/]react-router-dom[\\/]/.test(
                  id,
                )
              ) {
                return "vendor-react";
              }
              if (/[\\/]radix-ui[\\/]|[\\/]lucide-react[\\/]/.test(id)) {
                return "vendor-ui";
              }
              if (/[\\/]firebase[\\/](app|auth|firestore)/.test(id)) {
                return "vendor-firebase";
              }
              // dayjs + echarts are pure-utility vendors. They never import app
              // code, so they cannot introduce a vendor-utils <-> feature-components
              // chunk cycle on their own (see feature-components guard below).
              if (/[\\/]dayjs[\\/]|[\\/]echarts[\\/]/.test(id)) {
                return "vendor-utils";
              }
              return;
            }

            // Heavy cross-channel panels / creation & invite dialogs are co-located
            // for cache locality. They import only ui + services (never vendor-utils
            // directly). App-level re-export cycles across service modules (e.g. the
            // invitationService <-> organizationService re-export) are forbidden
            // because they were the source of the reported
            // `feature-components -> vendor-utils -> feature-components` cycle.
            const featureComponents = [
              "Compare.tsx",
              "DimensionsPanel.tsx",
              "AddListModal.tsx",
              "SaveListModal.tsx",
              "CreateOrganizationModal.tsx",
              "InviteMemberModal.tsx",
              "TransferOwnershipModal.tsx",
            ];
            if (
              featureComponents.some((f) =>
                id.includes(
                  `${path.sep}src${path.sep}components${path.sep}${f}`,
                ),
              )
            ) {
              return "feature-components";
            }
          },
        },
      },

      target: "es2020",
      chunkSizeWarningLimit: 600,
      sourcemap: false,
      cssCodeSplit: true,
      // Gzip-size reporting slows the build for zero runtime benefit; the
      // Docker image build sets DOCKER_BUILD=true to skip it. Local builds
      // (incl. `pnpm perf:budget`, which measures sizes itself) are unaffected.
      reportCompressedSize: process.env.DOCKER_BUILD !== "true",
    },

    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-router-dom",
        "radix-ui",
        "firebase/app",
        "firebase/auth",
        "firebase/firestore",
        "dayjs",
      ],
      exclude: ["@vite/client"],
    },
  };
});
