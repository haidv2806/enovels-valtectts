/**
 * Converts Float32Array PCM audio data to a 16-bit PCM WAV base64 string.
 * @param pcmData Float32Array normalized audio samples (-1.0 to 1.0)
 * @param sampleRate Sample rate in Hz (default 24000 for Valtec VITS)
 * @returns base64 encoded audio string
 */
export function pcmToWavBase64(pcmData: Float32Array, sampleRate: number = 24000): string {
  const numChannels = 1
  const bytesPerSample = 2 // 16-bit PCM
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = pcmData.length * bytesPerSample
  const fileSize = 36 + dataSize

  const buffer = new ArrayBuffer(fileSize + 8)
  const view = new DataView(buffer)

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  // RIFF header
  writeString(0, 'RIFF')
  view.setUint32(4, fileSize, true)
  writeString(8, 'WAVE')

  // fmt subchunk
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true) // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // BitsPerSample

  // data subchunk
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  // Write PCM samples
  let offset = 44
  for (let i = 0; i < pcmData.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, pcmData[i]))
    const sample = s < 0 ? s * 0x8000 : s * 0x7fff
    view.setInt16(offset, sample, true)
  }

  // Convert ArrayBuffer to base64
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000 // 32KB chunks for memory safety
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode.apply(null, Array.from(sub))
  }

  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(buffer).toString('base64')
}
