export interface TtsConfig {
  symbol_to_id: Record<string, number>
  language_id_map: Record<string, number>
  sample_rate: number
}

export const DEFAULT_DOWNLOAD_URLS: Record<string, string> = {
  'tts_config.json': 'https://raw.githubusercontent.com/haidv2806/valtec-tts/main/model/tts_config.json',
  'text_encoder.onnx': 'https://raw.githubusercontent.com/haidv2806/valtec-tts/main/model/text_encoder.onnx',
  'duration_predictor.onnx': 'https://raw.githubusercontent.com/haidv2806/valtec-tts/main/model/duration_predictor.onnx',
  'flow.onnx': 'https://raw.githubusercontent.com/haidv2806/valtec-tts/main/model/flow.onnx',
  'decoder.onnx': 'https://raw.githubusercontent.com/haidv2806/valtec-tts/main/model/decoder.onnx'
}

export const DEFAULT_TTS_CONFIG: TtsConfig = {
  symbol_to_id: { '_': 0, 'UNK': 305 },
  language_id_map: { 'VI': 7, 'EN': 0 },
  sample_rate: 24000
}

export class ModelManager {
  private config: TtsConfig | null = null

  constructor(private novel: NovelExtensionApi) {}

  async getConfig(): Promise<TtsConfig> {
    if (this.config) return this.config

    try {
      const storedConfig = await this.novel.storage?.get<any>('models/tts_config.json')
      let parsed: TtsConfig | null = null

      if (storedConfig) {
        if (typeof storedConfig === 'object' && storedConfig !== null && 'sample_rate' in storedConfig) {
          parsed = storedConfig as TtsConfig
        } else if (typeof storedConfig === 'string') {
          parsed = JSON.parse(storedConfig) as TtsConfig
        } else if (storedConfig.buffer instanceof ArrayBuffer) {
          const text = new TextDecoder().decode(storedConfig.buffer)
          parsed = JSON.parse(text) as TtsConfig
        } else if (typeof File !== 'undefined' && storedConfig instanceof File) {
          const text = await storedConfig.text()
          parsed = JSON.parse(text) as TtsConfig
        }
      }

      if (parsed && typeof parsed.sample_rate === 'number') {
        this.config = parsed
        return this.config
      }

      if (this.novel.network) {
        const remoteConfig = await this.novel.network.fetchJson<TtsConfig>(DEFAULT_DOWNLOAD_URLS['tts_config.json'])
        if (remoteConfig && typeof remoteConfig === 'object' && typeof remoteConfig.sample_rate === 'number') {
          await this.novel.storage?.set('models/tts_config.json', remoteConfig)
          this.config = remoteConfig
          return this.config
        }
      }
    } catch (e) {
      await this.novel.logger?.warn?.('[Valtec TTS] Failed to fetch config, using default config:', e)
    }

    this.config = DEFAULT_TTS_CONFIG
    return this.config
  }

  async getModelBuffer(fileName: string): Promise<ArrayBuffer> {
    const storageKey = `models/${fileName}`
    try {
      const stored = await this.novel.storage?.get<any>(storageKey)

      if (stored) {
        if (stored instanceof ArrayBuffer) {
          return stored
        }
        if (stored && typeof stored === 'object' && stored.buffer instanceof ArrayBuffer) {
          return stored.buffer
        }
        if (typeof File !== 'undefined' && stored instanceof File) {
          return await stored.arrayBuffer()
        }
        if (typeof stored === 'string') {
          return this.base64ToArrayBuffer(stored.replace(/^data:[^;]+;base64,/, ''))
        }
      }

      // Download via network if available
      const url = DEFAULT_DOWNLOAD_URLS[fileName]
      if (url && this.novel.network) {
        await this.novel.logger?.info?.(`[Valtec TTS] Downloading model ${fileName}...`)
        const dataUrl = await this.novel.network.fetchDataUrl(url)
        if (dataUrl && typeof dataUrl === 'string' && dataUrl.length > 0) {
          const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
          const buffer = this.base64ToArrayBuffer(base64)
          await this.novel.storage?.set(storageKey, base64)
          return buffer
        }
      }
    } catch (e) {
      await this.novel.logger?.warn?.(`[Valtec TTS] Error retrieving model buffer for ${fileName}:`, e)
    }

    return new ArrayBuffer(8)
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    if (typeof Buffer !== 'undefined') {
      const buf = Buffer.from(base64, 'base64')
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    }
    const binary = atob(base64)
    const len = binary.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes.buffer
  }
}
