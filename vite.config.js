import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // vtk.js 别名配置
      'vtk.js': '@kitware/vtk.js',
    }
  },
  optimizeDeps: {
    include: ['@kitware/vtk.js']
  }
})
