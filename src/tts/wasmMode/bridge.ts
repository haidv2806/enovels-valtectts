import { ValtecWasmEngine } from '../valtec/ValtecWasmEngine'

export class WasmBridge {
  private engine: ValtecWasmEngine

  constructor(private novel: NovelExtensionApi) {
    this.engine = new ValtecWasmEngine(novel)
  }

  async getVoices(): Promise<ExtensionTTSGetVoicesResponse> {
    return {
      voices: [
        { id: 'valtec-vi-1', name: 'Valtec Vietnamese Neural Voice', lang: 'vi-VN' }
      ]
    }
  }

  async speak(request: ExtensionTTSSpeakRequest): Promise<ExtensionTTSSpeakResponse> {
    const speakerId = request.voiceId ? parseInt(request.voiceId, 10) || 0 : 0
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
