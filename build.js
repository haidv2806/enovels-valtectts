const path = require('node:path')
const fs = require('node:fs')
const { build, context } = require('esbuild')

const root = __dirname
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension.json'), 'utf8'))
const extensionKind = manifest.starter?.kind
const isWatch = process.argv.includes('--watch') || process.argv.includes('-w')

async function bundle(outfile, platform) {
  const options = {
    entryPoints: [path.join(root, 'src/index.ts')],
    outfile: path.join(root, outfile),
    bundle: true,
    format: 'cjs',
    platform,
    mainFields: platform === 'browser' ? ['browser', 'module', 'main'] : ['module', 'main'],
    target: 'es2022',
    legalComments: 'none',
    minify: false,
    define: {
      __NOVEL_EXTENSION_KIND__: JSON.stringify(extensionKind),
      __NOVEL_TTS_MODE__: JSON.stringify(manifest.contributes?.tts?.mode || 'wasm')
    }
  }

  if (isWatch) {
    const ctx = await context(options)
    await ctx.watch()
    console.log(`[esbuild watch] Watching ${outfile} for changes...`)
  } else {
    await build(options)
  }
}

Promise.all([
  bundle('dist/index.js', 'neutral'),
  bundle('dist/browser.js', 'browser')
]).catch(error => {
  console.error(error)
  process.exitCode = 1
})