'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')

async function runValtecEngineTest() {
  const distPath = path.join(__dirname, '../../dist/index.js')
  const extension = require(distPath)
  let registeredTTS = null

  const mockNovel = {
    version: '1.0.0',
    platform: 'darwin',
    extension: {
      id: 'valtec-tts',
      manifest: {
        name: 'valtec-tts',
        contributes: { tts: { mode: 'wasm' } }
      }
    },
    logger: {
      info: async () => undefined,
      warn: async () => undefined,
      error: async () => undefined
    },
    tts: {
      register: async handlers => {
        registeredTTS = handlers
      }
    },
    storage: {
      get: async () => null,
      set: async () => undefined,
      remove: async () => undefined
    },
    network: {
      fetchJson: async () => ({
        symbol_to_id: { '_': 0, 'UNK': 305 },
        language_id_map: { 'VI': 7 },
        sample_rate: 24000
      }),
      fetchDataUrl: async () => ''
    }
  }

  await extension.activate(mockNovel)

  assert.ok(registeredTTS, 'TTS handlers registered successfully')

  const voicesRes = await registeredTTS.getVoices()
  assert.ok(Array.isArray(voicesRes.voices), 'getVoices returned voices list')
  assert.ok(voicesRes.voices.some(v => v.lang === 'vi-VN'), 'Vietnamese voice option included')

  const speakRes = await registeredTTS.speak({
    text: 'Xin chào, đây là hệ thống đọc tự động tiếng Việt.',
    voiceId: 'valtec-vi-1'
  })

  assert.equal(speakRes.mimeType, 'audio/wav', 'mimeType is audio/wav')
  assert.ok(typeof speakRes.audio === 'string' && speakRes.audio.length > 0, 'WAV audio string generated')

  console.log('[Valtec TTS Engine Unit Test] Passed!')
}

runValtecEngineTest().catch(err => {
  console.error(err)
  process.exitCode = 1
})
