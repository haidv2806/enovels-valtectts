import { ValtecWasmEngine } from '../valtec/ValtecWasmEngine'

const SPEAKER_MAP: Record<string, number> = {
  '0': 0, 'NF': 0,
  '1': 1, 'SF': 1,
  '2': 2, 'NM1': 2,
  '3': 3, 'SM': 3,
  '4': 4, 'NM2': 4
}

export class WasmBridge {
  private engine: ValtecWasmEngine

  constructor(private novel: NovelExtensionApi) {
    this.engine = new ValtecWasmEngine(novel)
  }

  async getVoices(): Promise<ExtensionTTSGetVoicesResponse> {
    return {
      voices: [
        { id: '0', name: 'Valtec Tiếng Việt - Nữ Miền Bắc (NF)', lang: 'vi-VN' },
        { id: '1', name: 'Valtec Tiếng Việt - Nữ Miền Nam (SF)', lang: 'vi-VN' },
        { id: '2', name: 'Valtec Tiếng Việt - Nam Miền Bắc 1 (NM1)', lang: 'vi-VN' },
        { id: '3', name: 'Valtec Tiếng Việt - Nam Miền Nam (SM)', lang: 'vi-VN' },
        { id: '4', name: 'Valtec Tiếng Việt - Nam Miền Bắc 2 (NM2)', lang: 'vi-VN' }
      ]
    }
  }

  async speak(request: ExtensionTTSSpeakRequest): Promise<ExtensionTTSSpeakResponse> {
    let speakerId = 0
    if (request.voiceId !== undefined && request.voiceId !== null) {
      if (request.voiceId in SPEAKER_MAP) {
        speakerId = SPEAKER_MAP[request.voiceId]
      } else {
        const parsed = parseInt(String(request.voiceId), 10)
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 4) {
          speakerId = parsed
        }
      }
    }

    const audioBase64 = await this.engine.synthesize(request.text, speakerId)

    return {
      audio: audioBase64,
      mimeType: 'audio/wav'
    }
  }

  async stop(): Promise<ExtensionTTSStopResponse> {
    await this.engine.stop()
    return { success: true }
  }
}
