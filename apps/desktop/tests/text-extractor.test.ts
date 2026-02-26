import { describe, it, expect } from 'vitest'
import { resolveFormat, isFormatSupported } from '../src/main/text-extractor'

describe('resolveFormat', () => {
  it('resolves .pdf extension', () => {
    expect(resolveFormat('report.pdf')).toBe('pdf')
  })

  it('resolves .pdf with download duplicate suffix: report.pdf (1)', () => {
    expect(resolveFormat('report.pdf (1)')).toBe('pdf')
  })

  it('resolves .pdf with inline number: report (1).pdf', () => {
    expect(resolveFormat('report (1).pdf')).toBe('pdf')
  })

  it('strips surrounding quotes', () => {
    expect(resolveFormat('"report.pdf"')).toBe('pdf')
  })

  it('strips query and fragment from filename', () => {
    expect(resolveFormat('report.pdf?x=1#y')).toBe('pdf')
  })

  it('falls back to mimeType when no extension', () => {
    expect(resolveFormat('noext', 'application/pdf')).toBe('pdf')
  })

  it('mimeType fallback is case-insensitive', () => {
    expect(resolveFormat('noext', 'APPLICATION/PDF')).toBe('pdf')
  })

  it('returns null for unsupported extension with no mimeType', () => {
    expect(resolveFormat('photo.jpg')).toBeNull()
  })

  it('falls back to mimeType when extension is wrong', () => {
    expect(resolveFormat('report.dat', 'application/pdf')).toBe('pdf')
  })

  it('resolves .xlsx', () => {
    expect(resolveFormat('data.xlsx')).toBe('xlsx')
  })

  it('resolves .xls', () => {
    expect(resolveFormat('legacy.xls')).toBe('xls')
  })

  it('resolves .docx', () => {
    expect(resolveFormat('document.docx')).toBe('docx')
  })

  it('resolves xlsx via mimeType', () => {
    expect(resolveFormat('file', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('xlsx')
  })

  it('resolves xls via mimeType', () => {
    expect(resolveFormat('file', 'application/vnd.ms-excel')).toBe('xls')
  })

  it('resolves docx via mimeType', () => {
    expect(resolveFormat('file', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx')
  })

  it('returns null for completely unknown file', () => {
    expect(resolveFormat('mystery')).toBeNull()
  })

  it('handles whitespace-padded filenames', () => {
    expect(resolveFormat('  report.pdf  ')).toBe('pdf')
  })
})

describe('isFormatSupported', () => {
  it('returns true for supported extension', () => {
    expect(isFormatSupported('report.pdf')).toBe(true)
  })

  it('returns true for supported mimeType fallback', () => {
    expect(isFormatSupported('noext', 'application/pdf')).toBe(true)
  })

  it('returns false for unsupported file', () => {
    expect(isFormatSupported('photo.jpg')).toBe(false)
  })
})
