import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [{
    name: 'inline-rescue-save-code',
    apply: 'build',
    async buildStart() {
      const [template, source] = await Promise.all([
        readFile(new URL('./public/rescue.html', import.meta.url), 'utf8'),
        readFile(new URL('./src/save-code.ts', import.meta.url), 'utf8'),
      ])
      const marker = '/*__SCOOPALOO_SAVE_CODE__*/'
      if (!template.includes(marker)) throw new Error('rescue save-code marker missing')
      const code = ts.transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ES2022,
          removeComments: true,
        },
      }).outputText
      this.emitFile({ type: 'asset', fileName: 'rescue.html', source: template.replace(marker, code) })
    },
  }],
  server: { host: '127.0.0.1', port: 4173 },
  preview: { host: '127.0.0.1', port: 4173 },
  test: { include: ['src/**/*.test.ts'] },
})
