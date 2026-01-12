export interface PhotoRecord {
  hiddenGemId: number
  storageKey: string
  thumbnailStorageKey: string
  originalFileName: string
  caption: string | null
  isPrimary: boolean
  fileSize: number
  mimeType: string
  width: number
  height: number
}
