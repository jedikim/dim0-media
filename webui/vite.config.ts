import path from "path"
import { readFileSync } from "fs"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { visualizer } from "rollup-plugin-visualizer"
import { VitePWA } from "vite-plugin-pwa"

const packageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, "./package.json"), "utf8")
) as { version?: string }
const appVersion = packageJson.version ?? "0.0.0"
const shouldAnalyzeBundle = process.env.ANALYZE === "true"
const allowedHosts = [
  "app.dim0.net",
]


export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    shouldAnalyzeBundle && visualizer({
      filename: "dist/stats.html",
      gzipSize: true,
      brotliSize: true,
      template: "treemap",
    }),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon-16x16.png",
        "favicon-32x32.png",
        "apple-touch-icon.png",
        "dim0.svg",
      ],
      manifest: {
        name: "Dim0",
        short_name: "Dim0",
        description: "Visual workspace for boards, notes, and agent-assisted thinking.",
        theme_color: "#f7f1e8",
        background_color: "#f7f1e8",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        /**
         * Groups heavy third-party packages into stable chunks so route code
         * stays smaller and bundle analysis is easier to reason about.
         */
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("@hugeicons")) return "hugeicons"
            if (id.includes("lucide-react")) return "lucide"
            if (id.includes("@lobehub/icons")) return "lobehub-icons"
            if (id.includes("simple-icons")) return "simple-icons"
            if (id.includes("@tanstack")) return "tanstack"
            if (id.includes("@dagrejs")) return "dagre"
            if (id.includes("@radix-ui")) return "radix"
            if (id.includes("d3")) return "d3"
            if (id.includes("@milkdown")) return "milkdown"
            if (id.includes("@lezer")) return "lezer"
            if (id.includes("@codemirror")) return "codemirror"
            if (id.includes("/node_modules/motion/") || id.includes("framer-motion")) return "motion"
            if (id.includes("recharts")) return "recharts"
            if (id.includes("highlight.js")) return "highlightjs"
            if (
              id.includes("/node_modules/prosemirror-") ||
              id.includes("/node_modules/@prosemirror/") ||
              id.includes("/node_modules/prosemirror/")
            ) return "prosemirror"
            if (id.includes("roughjs")) return "roughjs"
            if (id.includes("katex")) return "katex"
            if (id.includes("@xyflow/react")) return "reactflow"
            if (id.includes("chevrotain")) return "chevrotain"
            if (id.includes("cytoscape-fcose")) return "cytoscape-fcose"
            if (id.includes("/node_modules/mermaid/")) return "mermaid"
            if (id.includes("/node_modules/cytoscape/")) return "cytoscape"
            if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react"
          }
        },
      },
    },
  },
  server: {
    allowedHosts,
    host: "0.0.0.0",
    port: Number(process.env.APP_PORT) || 5173,
  },
  preview: {
    allowedHosts,
    host: "0.0.0.0",
    port: Number(process.env.APP_PORT) || 5173,
  },
})
