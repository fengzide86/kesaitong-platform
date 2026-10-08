import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { visualizer } from 'rollup-plugin-visualizer'
import { readFileSync } from 'node:fs'

const packageMetadata = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig(({ command, mode }) => {
  const desktopBuild = process.env.TOOLBOX_BUILD_TARGET === 'electron'
  const environment = loadEnv(mode, process.cwd(), '')
  const developmentApiTarget = environment.VITE_DEV_API_TARGET
    || environment.VITE_CONTROL_API_BASE
    || environment.VITE_API_BASE
    || 'http://127.0.0.1:8000'
  // Declaration files are checked into the repository for type tooling.
  // Rewriting them during every production build can race with Windows
  // Defender/indexers and fail with EBUSY/UNKNOWN even though runtime output
  // is otherwise valid. Only the interactive Vite server refreshes them.
  const declarationOutput = command === 'serve'
  return {
    plugins: [
      vue({
        template: {
          compilerOptions: {
            isCustomElement: tag => tag === 'webview',
          },
        },
      }),
      // 自动导入 Vue、Vue Router、Pinia 等 API
      AutoImport({
        imports: ['vue', 'vue-router', 'pinia'],
        resolvers: [ElementPlusResolver()],
        dts: declarationOutput ? 'src/auto-imports.d.ts' : false,
      }),
      // 自动导入 Element Plus 组件
      Components({
        resolvers: [ElementPlusResolver()],
        dts: declarationOutput ? 'src/components.d.ts' : false,
      }),
      // 构建分析（仅在分析模式时启用）
      mode === 'analyze' && visualizer({
        open: true,
        filename: 'dist/stats.html',
        gzipSize: true,
        brotliSize: true,
      }),
    ].filter(Boolean),
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageMetadata.version),
      // .env.production contains the desktop control-plane fallback. Local
      // browser renderer tests use their own origin (/api), unless an isolated
      // build explicitly injects an API URL (for example real-backend E2E).
      // Do not apply this override to Electron or the development server.
      ...(command === 'build' && !desktopBuild ? {
        'import.meta.env.VITE_CONTROL_API_BASE': JSON.stringify(process.env.VITE_CONTROL_API_BASE || ''),
        'import.meta.env.VITE_API_BASE': JSON.stringify(process.env.VITE_API_BASE || ''),
      } : {}),
    },
    base: './',
    server: {
      port: 3000,
      open: false, // 开发预览模式由 Electron 加载，不自动打开浏览器
      proxy: {
        '/api': {
          target: developmentApiTarget,
          changeOrigin: true,
          secure: false,
        },
        '/updates': {
          target: developmentApiTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    // 预构建依赖，加速开发服务器启动
    optimizeDeps: {
      include: [
        'vue',
        'vue-router',
        'pinia',
      ],
      exclude: [
        // Sentry 体积大，不预构建
      ]
    },
    build: {
      // 代码分割策略
      rollupOptions: {
        output: {
          // 手动分割 chunk
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            if (/[\\/]node_modules[\\/](vue|vue-router|pinia)[\\/]/.test(id)) return 'vendor-vue'
            if (mode === 'production' && /[\\/]node_modules[\\/]@sentry[\\/]/.test(id)) return 'vendor-sentry'
            return undefined
          },
          // 减小 chunk 大小警告阈值
          chunkFileNames: 'assets/js/[name]-[hash].js',
          entryFileNames: 'assets/js/[name]-[hash].js',
          assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
        }
      },
      // 生产环境移除 console 和 debugger
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: mode === 'production',
          drop_debugger: true,
        }
      },
      // ExcelJS is an intentionally lazy-loaded spreadsheet chunk (~911 KB).
      // Entry and shared vendor chunks remain below 120 KB.
      chunkSizeWarningLimit: 1000,
      // CSS 代码分离
      cssCodeSplit: true,
      // PurgeCSS keeps the global design-token set; esbuild then safely
      // minifies the declarations without cross-chunk variable pruning.
      cssMinify: 'esbuild',
      // 生成 sourcemap（仅开发环境）
      sourcemap: mode !== 'production',
    },
  }
})
