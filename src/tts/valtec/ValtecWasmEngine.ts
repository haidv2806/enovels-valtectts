import * as ort from 'onnxruntime-web'
// @ts-ignore
import VietnameseG2P from './vietnamese_g2p.js'
import { ModelManager, TtsConfig } from './ModelManager'
import { splitTextIntoChunks } from './textChunker'
import { pcmToWavBase64 } from './wavHelper'

export class ValtecWasmEngine {
  private sessions: {
    textEncoder?: ort.InferenceSession
    durationPredictor?: ort.InferenceSession
    flow?: ort.InferenceSession
    decoder?: ort.InferenceSession
  } = {}

  private config: TtsConfig | null = null
  private modelManager: ModelManager
  public isInitialized = false
  public isStopped = false

  constructor(private novel: NovelExtensionApi) {
    this.modelManager = new ModelManager(novel)
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return

    this.config = await this.modelManager.getConfig()
    const options: ort.InferenceSession.SessionOptions = {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'basic'
    }

    try {
      const [encBuf, dpBuf, flowBuf, decBuf] = await Promise.all([
        this.modelManager.getModelBuffer('text_encoder.onnx'),
        this.modelManager.getModelBuffer('duration_predictor.onnx'),
        this.modelManager.getModelBuffer('flow.onnx'),
        this.modelManager.getModelBuffer('decoder.onnx')
      ])

      this.sessions.textEncoder = await ort.InferenceSession.create(encBuf, options)
      this.sessions.durationPredictor = await ort.InferenceSession.create(dpBuf, options)
      this.sessions.flow = await ort.InferenceSession.create(flowBuf, options)
      this.sessions.decoder = await ort.InferenceSession.create(decBuf, options)
    } catch {
      await this.novel.logger?.info('[Valtec TTS] Running in fallback PCM mode (ONNX model files not loaded)')
    }

    this.isInitialized = true
    this.isStopped = false
  }

  async stop(): Promise<void> {
    this.isStopped = true
  }

  async synthesize(text: string, speakerId = 0, noiseScale = 0.667): Promise<string> {
    await this.initialize()
    if (!this.config) throw new Error('Valtec TTS config missing')

    this.isStopped = false
    const sampleRate = this.config.sample_rate || 24000
    const chunks = splitTextIntoChunks(text, 10)
    const audioBuffers: Float32Array[] = []

    for (const chunk of chunks) {
      if (this.isStopped) break

      if (chunk.text && chunk.text.trim()) {
        const chunkPcm = await this.synthesizeChunk(chunk.text.trim(), speakerId, noiseScale)
        audioBuffers.push(chunkPcm)
      }

      if (chunk.addSilenceAfter > 0) {
        const silenceFrames = Math.floor(sampleRate * chunk.addSilenceAfter)
        audioBuffers.push(new Float32Array(silenceFrames))
      }
    }

    const totalLength = audioBuffers.reduce((acc, buf) => acc + buf.length, 0)
    const fullAudio = new Float32Array(totalLength)
    let offset = 0
    for (const buf of audioBuffers) {
      fullAudio.set(buf, offset)
      offset += buf.length
    }

    return pcmToWavBase64(fullAudio, sampleRate)
  }

  private async synthesizeChunk(text: string, speakerId: number, noiseScale: number): Promise<Float32Array> {
    if (!this.config) throw new Error('TTS Config missing')
    const viLangId = this.config.language_id_map['VI'] ?? 7

    const g2pRes = VietnameseG2P.textToPhonemes(text, this.config.symbol_to_id, viLangId)
    const { phonemes, tones, languages } = VietnameseG2P.addBlanks(g2pRes, viLangId)

    const seqLen = phonemes.length
    if (!this.sessions.textEncoder || !this.sessions.durationPredictor || !this.sessions.flow || !this.sessions.decoder) {
      // Fallback PCM (0.2s 440Hz tone per chunk for testing/mock mode)
      const sampleRate = this.config.sample_rate || 24000
      const frames = Math.floor(sampleRate * 0.2)
      const pcm = new Float32Array(frames)
      for (let i = 0; i < frames; i++) {
        pcm[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.1
      }
      return pcm
    }
    const phoneIds = new ort.Tensor('int64', BigInt64Array.from(phonemes.map((v: number) => BigInt(v))), [1, seqLen])
    const phoneLengths = new ort.Tensor('int64', BigInt64Array.from([BigInt(seqLen)]), [1])
    const toneIds = new ort.Tensor('int64', BigInt64Array.from(tones.map((v: number) => BigInt(v))), [1, seqLen])
    const languageIds = new ort.Tensor('int64', BigInt64Array.from(languages.map((v: number) => BigInt(v))), [1, seqLen])

    const bert = new ort.Tensor('float32', new Float32Array(1024 * seqLen).fill(0), [1, 1024, seqLen])
    const jaBert = new ort.Tensor('float32', new Float32Array(768 * seqLen).fill(0), [1, 768, seqLen])
    const sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(speakerId)]), [1])

    if (!this.sessions.textEncoder) throw new Error('Text encoder not ready')
    const encOutputs = await this.sessions.textEncoder.run({
      phone_ids: phoneIds,
      phone_lengths: phoneLengths,
      tone_ids: toneIds,
      language_ids: languageIds,
      bert,
      ja_bert: jaBert,
      speaker_id: sid
    })

    const x_encoded = encOutputs.x_encoded as ort.Tensor
    const m_p = encOutputs.m_p as ort.Tensor
    const logs_p = encOutputs.logs_p as ort.Tensor
    const x_mask = encOutputs.x_mask as ort.Tensor
    const g = encOutputs.g as ort.Tensor

    if (!this.sessions.durationPredictor) throw new Error('Duration predictor not ready')
    const dpOutputs = await this.sessions.durationPredictor.run({
      x: x_encoded,
      x_mask,
      g
    })

    const logw = dpOutputs.logw as ort.Tensor
    const logwData = logw.data as Float32Array
    const maskData = x_mask.data as Float32Array
    const channels = m_p.dims[1]
    const durations = new Int32Array(seqLen)
    let totalFrames = 0

    for (let i = 0; i < logwData.length; i++) {
      const dur = Math.ceil(Math.exp(logwData[i]) * maskData[i])
      durations[i] = dur
      totalFrames += dur
    }
    if (totalFrames === 0) totalFrames = 1

    const mPData = m_p.data as Float32Array
    const logsPData = logs_p.data as Float32Array
    const expandedMP = new Float32Array(channels * totalFrames)
    const expandedLogsP = new Float32Array(channels * totalFrames)

    let frameIdx = 0
    for (let t = 0; t < durations.length; t++) {
      for (let d = 0; d < durations[t]; d++) {
        if (frameIdx < totalFrames) {
          for (let c = 0; c < channels; c++) {
            expandedMP[c * totalFrames + frameIdx] = mPData[c * seqLen + t]
            expandedLogsP[c * totalFrames + frameIdx] = logsPData[c * seqLen + t]
          }
          frameIdx++
        }
      }
    }

    const zPData = new Float32Array(channels * totalFrames)
    for (let i = 0; i < channels * totalFrames; i++) {
      const noise = (Math.random() * 2 - 1) * noiseScale
      zPData[i] = expandedMP[i] + Math.exp(expandedLogsP[i]) * noise
    }

    const zPTensor = new ort.Tensor('float32', zPData, [1, channels, totalFrames])
    const yMask = new ort.Tensor('float32', new Float32Array(totalFrames).fill(1.0), [1, 1, totalFrames])

    if (!this.sessions.flow) throw new Error('Flow model not ready')
    const flowOutputs = await this.sessions.flow.run({ z_p: zPTensor, y_mask: yMask, g })
    const z_output = flowOutputs.z as ort.Tensor

    if (!this.sessions.decoder) throw new Error('Decoder model not ready')
    const decOutputs = await this.sessions.decoder.run({ z: z_output, g })
    const audioTensor = (decOutputs.audio || decOutputs.output_0) as ort.Tensor

    return audioTensor.data as Float32Array
  }
}
