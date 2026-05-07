import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { getBlogSitemapPaths } from './src/content/blog-posts'

function resolvePublicSiteUrl(mode: string): string {
  const env = loadEnv(mode, process.cwd(), '')
  const raw = env.VITE_PUBLIC_SITE_URL || 'https://editor.kubeez.com'
  return raw.replace(/\/+$/, '')
}

/**
 * Production builds for editor.kubeez.com infer `VITE_KUBEEZ_BROWSER_API_URL=https://api.kubeez.com`
 * when that env is unset (Hetzner static hosting without /api/kubeez nginx). Override in `.env.production`
 * or nginx proxy (see deploy/nginx-kubeez-proxy.snippet.conf). Other hosts keep same-origin /api/kubeez.
 */
function kubeezBrowserApiEnvDefine(mode: string): Record<string, string> {
  const env = loadEnv(mode, process.cwd(), '')
  if (env.VITE_KUBEEZ_BROWSER_API_URL !== undefined) {
    return {}
  }
  if (mode !== 'production') {
    return {}
  }
  const siteUrl = env.VITE_PUBLIC_SITE_URL || 'https://editor.kubeez.com'
  let host: string
  try {
    host = new URL(siteUrl.replace(/\/+$/, '')).hostname
  } catch {
    return {}
  }
  if (host !== 'editor.kubeez.com' && !host.endsWith('.editor.kubeez.com')) {
    return {}
  }
  return {
    'import.meta.env.VITE_KUBEEZ_BROWSER_API_URL': JSON.stringify('https://api.kubeez.com'),
  }
}

/** Replaces %SITE_URL% in index.html; writes robots.txt + sitemap.xml + ai.txt on production build. */
function seoPlugin(siteUrl: string): Plugin {
  let outDir = 'dist'
  return {
    name: 'seo-site-url',
    configResolved(config) {
      outDir = config.build.outDir
    },
    transformIndexHtml(html) {
      return html.replaceAll('%SITE_URL%', siteUrl)
    },
    closeBundle() {
      const robots = `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`
      const staticPaths = ['/', '/projects', ...getBlogSitemapPaths()]
      const indexablePaths = staticPaths.filter((p) => !p.includes('$'))
      const urlEntries = staticPaths
        .map((p) => {
          const loc = p === '/' ? `${siteUrl}/` : `${siteUrl}${p}`
          const priority =
            p === '/' ? '1.0' : p === '/projects' || p === '/blog' ? '0.9' : p.startsWith('/blog/') ? '0.85' : '0.8'
          const changefreq = p.startsWith('/blog') ? 'monthly' : 'weekly'
          return `  <url>
    <loc>${loc}</loc>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`
        })
        .join('\n')
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`
      const aiTxt = [
        '# KubeezCut AI discovery file',
        `Site: ${siteUrl}`,
        `Sitemap: ${siteUrl}/sitemap.xml`,
        '',
        'Preferred-Crawl: true',
        'Allow: /',
        '',
        '# High-value pages',
        ...indexablePaths.map((p) => (p === '/' ? `${siteUrl}/` : `${siteUrl}${p}`)),
      ].join('\n')
      fs.mkdirSync(outDir, { recursive: true })
      fs.writeFileSync(path.join(outDir, 'robots.txt'), robots, 'utf8')
      fs.writeFileSync(path.join(outDir, 'sitemap.xml'), sitemap, 'utf8')
      fs.writeFileSync(path.join(outDir, 'ai.txt'), aiTxt, 'utf8')
      // llms.txt is recognized by more AI crawlers; keep same content as ai.txt.
      fs.writeFileSync(path.join(outDir, 'llms.txt'), aiTxt, 'utf8')
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  define: kubeezBrowserApiEnvDefine(mode),
  plugins: [react(), tailwindcss(), seoPlugin(resolvePublicSiteUrl(mode))],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    /**
     * Allowed `Host` headers. `dev-editor.kubeez.com` is reached through a
     * Cloudflare tunnel for end-to-end SSO testing — `*.kubeez.com` cookie
     * is shared with prod kubeez.com auth, so the real bounce flow works
     * locally without any allow-list patches on the apex.
     */
    allowedHosts: ['localhost', 'dev-editor.kubeez.com'],
    /**
     * HMR over the Cloudflare tunnel: when `VITE_DEV_TUNNEL_HOST` is set
     * (e.g. `dev-editor.kubeez.com`), the websocket client connects through
     * the tunnel via wss:443. Unset → default behavior for plain localhost.
     */
    hmr: process.env.VITE_DEV_TUNNEL_HOST
      ? {
          host: process.env.VITE_DEV_TUNNEL_HOST,
          protocol: 'wss',
          clientPort: 443,
        }
      : undefined,
    /** Same-origin `/api/kubeez/*` → api.kubeez.com (avoids CORS + COEP). Must match production rewrites in vercel.json. */
    proxy: {
      // More specific first: `/api/kubeez` is a prefix of `/api/kubeez/cdn/...`; wrong order sends CDN fetches to the API host (HTML/404).
      '/api/kubeez/cdn': {
        target: 'https://media.kubeez.com',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/api\/kubeez\/cdn/, '') || '/',
      },
      '/api/kubeez': {
        target: 'https://api.kubeez.com',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/api\/kubeez/, '') || '/',
        /** Long-lived SSE (e.g. GET .../stream up to ~10m); avoid proxy idle timeouts. */
        timeout: 0,
        proxyTimeout: 0,
      },
    },
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      // `same-origin-allow-popups` (vs. `same-origin`) keeps cross-origin
      // isolation for SharedArrayBuffer in the export pipeline AND keeps
      // the `window.opener` reference intact for popups we open ourselves
      // — needed by the Kubeez sign-in popup → callback → postMessage flow.
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    },
  },
  preview: {
    proxy: {
      '/api/kubeez/cdn': {
        target: 'https://media.kubeez.com',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/api\/kubeez\/cdn/, '') || '/',
      },
      '/api/kubeez': {
        target: 'https://api.kubeez.com',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/api\/kubeez/, '') || '/',
        /** Long-lived SSE (e.g. GET .../stream up to ~10m); avoid proxy idle timeouts. */
        timeout: 0,
        proxyTimeout: 0,
      },
    },
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    },
  },
  build: {
    target: 'esnext',
    sourcemap: true,
    // @mediabunny/ac3 is an intentionally large lazy decoder bundle (~1.1 MB minified).
    // Keep warnings focused on unexpected growth rather than this known outlier.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Logger must be in its own chunk to avoid circular chunk TDZ errors.
          // Without this, Rollup places it in composition-runtime which has a
          // circular import with media-library, causing "Cannot access before
          // initialization" in production builds.
          if (id.endsWith('src/shared/logging/logger.ts')) {
            return 'core-logger';
          }

          // Timeline bridge modules that re-export UI must live with the UI
          // chunk; otherwise core ends up importing UI, which creates a
          // feature-editing-core <-> feature-editing-ui TDZ cycle at startup.
          if (
            id.includes('/src/features/timeline/contracts/editor.ts')
            || id.includes('/src/features/timeline/index.ts')
          ) {
            return 'feature-editing-ui';
          }

          // Application feature chunks
          if (id.includes('/src/features/timeline/') || id.includes('/src/features/media-library/')) {
            if (id.includes('/components/')) {
              return 'feature-editing-ui';
            }
            return 'feature-editing-core';
          }
          if (id.includes('/src/features/effects/')) {
            return 'feature-effects';
          }
          // Composition-runtime shares deeply coupled deps with editing-core
          // (timeline stores, keyframes, export utils). Merging them into one
          // chunk eliminates the circular chunk dependency that causes TDZ
          // errors ("Cannot access before initialization") in production builds.
          if (id.includes('/src/features/composition-runtime/')) {
            return 'feature-editing-core';
          }

          // React must be in its own chunk, loaded first to ensure proper initialization
          // This prevents "Cannot set properties of undefined" errors with React 19.2 features
          if (id.includes('node_modules/react-dom')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/react/')) {
            return 'react-vendor';
          }
          // Router framework
          if (id.includes('@tanstack/react-router')) {
            return 'router-vendor';
          }
          // State management
          if (id.includes('/node_modules/zustand/') || id.includes('/node_modules/zundo/')) {
            return 'state-vendor';
          }
          // Media processing - loaded on demand
          if (id.includes('@mediabunny/ac3')) {
            return 'media-ac3-decoder';
          }
          if (id.includes('@mediabunny/mp3-encoder')) {
            return 'media-mp3-encoder';
          }
          if (id.includes('/node_modules/mediabunny/')) {
            return 'media-bunny-core';
          }
          if (id.includes('@mediabunny/')) {
            return 'media-processing';
          }
          // Audio/video processing helpers
          if (id.includes('/node_modules/soundtouchjs/')) {
            return 'audio-processing';
          }
          // RNNoise WASM is large; lazy-loaded inside the audio-enhance worker.
          if (id.includes('@jitsi/rnnoise-wasm')) {
            return 'audio-rnnoise';
          }
          if (id.includes('/node_modules/gifuct-js/')) {
            return 'gif-processing';
          }
          // UI framework
          if (id.includes('@radix-ui/')) {
            return 'vendor-ui';
          }
          // Icons - keep lucide-react in separate chunk for better caching
          if (id.includes('lucide-react')) {
            return 'vendor-icons';
          }
          return undefined;
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['mediabunny', '@mediabunny/ac3', '@mediabunny/mp3-encoder', '@jitsi/rnnoise-wasm'],
    // Pre-bundle lucide-react for faster dev startup (avoids analyzing 1500+ icons on each reload)
    include: ['lucide-react'],
  },
}))
