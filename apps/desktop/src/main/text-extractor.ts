/**
 * Shared text extraction for binary documents.
 * Used by both file:extract-text IPC and gmail attachment enrichment.
 */

const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
}

export function resolveFormat(filename: string, mimeType?: string): string | null {
  const clean = filename.trim().replace(/^"|"$/g, '').split(/[?#]/)[0]
  // Strip trailing " (1)" suffix first, then extract extension
  const normalized = clean.replace(/\s*\(\d+\)\s*$/, '')
  const extMatch = normalized.match(/\.([a-z0-9]{2,5})$/i)
  const ext = extMatch ? extMatch[1].toLowerCase() : ''
  if (['pdf', 'xlsx', 'xls', 'docx'].includes(ext)) return ext
  // Fallback: mimeType mapping when extension is missing/incorrect
  if (mimeType && MIME_TO_EXT[mimeType.toLowerCase()]) return MIME_TO_EXT[mimeType.toLowerCase()]
  return null
}

export async function extractTextFromBuffer(
  filename: string,
  buf: Buffer,
  mimeType?: string,
): Promise<string> {
  const format = resolveFormat(filename, mimeType)
  if (!format) throw new Error(`Unsupported format: ${filename}`)

  if (format === 'pdf') {
    const { getDocumentProxy, extractText } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buf))
    const { text } = await extractText(pdf, { mergePages: true })
    return text as string
  }
  if (format === 'xlsx' || format === 'xls') {
    const XLSX = await import('xlsx')
    const workbook = XLSX.read(buf, { type: 'buffer' })
    const sheets: string[] = []
    for (const name of workbook.SheetNames) {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name])
      sheets.push(`--- Sheet: ${name} ---\n${csv}`)
    }
    return sheets.join('\n\n')
  }
  if (format === 'docx') {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer: buf })
    return result.value
  }
  throw new Error(`Unsupported format: ${format}`)
}

export function isFormatSupported(filename: string, mimeType?: string): boolean {
  return resolveFormat(filename, mimeType) !== null
}
