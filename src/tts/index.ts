import { ProcessBridge } from './processMode/bridge'
import { CloudBridge } from './cloudMode/bridge'
import { WasmBridge } from './wasmMode/bridge'

declare const __NOVEL_TTS_MODE__: string | undefined

export async function activateTTS(novel: NovelExtensionApi): Promise<void> {
  if (!novel.tts) return
  const mode =
    (typeof __NOVEL_TTS_MODE__ !== 'undefined' ? __NOVEL_TTS_MODE__ : undefined) ||
    novel.extension?.manifest?.contributes?.tts?.mode ||
    'wasm'

  if (mode === 'process') {
    const bridge = new ProcessBridge(novel)
    // Register TTS capabilities
    await novel.tts.register({
      getVoices: async () => {
        if (!novel.process) {
          throw new Error('novel.process is only available on Electron Desktop.')
        }
        await bridge.startProcess('bin/server')
        return await bridge.sendCommand('getVoices', {})
      },
      speak: async (params: ExtensionTTSSpeakRequest) => {
        return await bridge.sendCommand('speak', params)
      },
      stop: async () => {
        return await bridge.sendCommand('stop', {})
      }
    })
  } else if (mode === 'cloud') {
    const bridge = new CloudBridge(novel)
    await novel.tts.register({
      getVoices: async () => bridge.getVoices(),
      speak: async (params: ExtensionTTSSpeakRequest) => bridge.speak(params),
      stop: async () => bridge.stop()
    })
  } else if (mode === 'wasm') {
    const bridge = new WasmBridge(novel)
    await novel.tts.register({
      getVoices: async () => bridge.getVoices(),
      speak: async (params: ExtensionTTSSpeakRequest) => bridge.speak(params),
      stop: async () => bridge.stop()
    })
  }
}
