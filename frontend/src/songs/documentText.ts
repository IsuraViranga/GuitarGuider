// Takes the text out of a Word (.docx) or PDF song sheet, line by line, so it can be shown in the
// paste box (where the user sees exactly what was read) and imported like pasted text.
// Nothing is guessed: no recognising text in pictures (scans), because that cannot be exact.

import { strFromU8, unzipSync } from 'fflate'
import { damagedSinhalaWords } from './text'

export const DOCUMENT_FILE_PATTERN = /\.(docx|pdf)$/i
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024

/** `damagedWords`: Sinhala words that came out as symbols (a PDF with broken Sinhala letters). */
export type DocumentTextResult = { ok: true; text: string; damagedWords: number } | { ok: false; message: string }

export function isDocumentFileName(name: string): boolean {
  return DOCUMENT_FILE_PATTERN.test(name)
}

export async function extractDocumentText(name: string, bytes: Uint8Array): Promise<DocumentTextResult> {
  try {
    const text = /\.pdf$/i.test(name) ? await pdfText(bytes) : docxText(bytes)
    if (!/\d/.test(text)) {
      return {
        ok: false,
        message: /\.pdf$/i.test(name)
          ? 'No text was found in this PDF. It may be a scan or a photo of the sheet. Please use the Word file, or type the numbers.'
          : 'No text was found in this document.',
      }
    }
    const damagedWords = text.split(/\r?\n/).reduce((count, line) => count + damagedSinhalaWords(line).length, 0)
    return { ok: true, text, damagedWords }
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException') {
      return { ok: false, message: 'This PDF is protected with a password. Please use a copy without a password.' }
    }
    return { ok: false, message: 'This file could not be read. It may be damaged, or not a Word (.docx) or PDF file.' }
  }
}

// ---------- Word (.docx) ----------

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'

/** The main text of a .docx: each paragraph (and table row, and text box paragraph) is one line. */
export function docxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: (file) => file.name === 'word/document.xml' })
  const xml = files['word/document.xml']
  if (!xml) throw new Error('Not a Word document')
  const doc = new DOMParser().parseFromString(strFromU8(xml), 'application/xml')
  const body = doc.getElementsByTagNameNS(W, 'body')[0]
  if (!body) throw new Error('Not a Word document')
  const lines: string[] = []
  blockLines(body, lines)
  return lines.join('\n')
}

function isW(node: Node, localName: string): node is Element {
  return node.nodeType === 1 && (node as Element).namespaceURI === W && (node as Element).localName === localName
}

/** Paragraphs and tables, in document order. */
function blockLines(parent: Element, lines: string[]) {
  for (const child of Array.from(parent.childNodes)) {
    if (isW(child, 'p')) {
      const extra: string[] = []
      lines.push(paragraphText(child, extra))
      lines.push(...extra)
    } else if (isW(child, 'tbl')) {
      for (const row of Array.from(child.getElementsByTagNameNS(W, 'tr'))) {
        const cells = Array.from(row.childNodes).filter((c): c is Element => isW(c, 'tc'))
        // A table row (e.g. numbers in cells) becomes one line, cells separated by spaces.
        lines.push(cells.map((cell) => Array.from(cell.getElementsByTagNameNS(W, 'p')).map((p) => paragraphText(p, [])).join(' ')).join('   '))
      }
    } else if (child.nodeType === 1 && ((child as Element).localName === 'sdt' || (child as Element).localName === 'sdtContent' || (child as Element).localName === 'customXml')) {
      blockLines(child as Element, lines)
    }
  }
}

/** The text of one paragraph. Text boxes inside it are added to `extra` as lines of their own. */
function paragraphText(paragraph: Element, extra: string[]): string {
  let text = ''
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== 1) continue
      const el = child as Element
      if (el.namespaceURI === MC && el.localName === 'Fallback') continue // the same content again, for old Word
      if (el.namespaceURI === W) {
        if (el.localName === 'del' || el.localName === 'delText' || el.localName === 'instrText') continue // deleted text, field codes
        if (el.localName === 't') text += el.textContent ?? ''
        else if (el.localName === 'tab') text += '    '
        else if (el.localName === 'br' || el.localName === 'cr') text += '\n'
        else if (el.localName === 'noBreakHyphen') text += '-'
        else if (el.localName === 'txbxContent') blockLines(el, extra)
        else walk(el)
      } else {
        walk(el)
      }
    }
  }
  walk(paragraph)
  return text
}

// ---------- PDF ----------

type PdfTextItem = { str: string; transform: number[]; width: number; height: number }

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  const task = pdfjs.getDocument({ data: bytes })
  try {
    const pdf = await task.promise
    const pages: string[] = []
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n)
      const content = await page.getTextContent()
      const items = content.items.flatMap((item) => ('str' in item ? [item] : []))
      pages.push(textItemsToLines(items).join('\n'))
    }
    return pages.join('\n\n')
  } finally {
    await task.destroy()
  }
}

/**
 * Rebuilds lines from positioned pieces of text: pieces at the same height are one line, read left
 * to right, with spaces where there is a gap; a bigger gap between lines becomes an empty line.
 */
export function textItemsToLines(items: readonly PdfTextItem[]): string[] {
  type Row = { y: number; size: number; items: PdfTextItem[] }
  const rows: Row[] = []
  for (const item of items) {
    if (!item.str) continue
    const y = item.transform[5]
    const size = Math.abs(item.transform[3]) || item.height || 10
    const row = rows.find((r) => Math.abs(r.y - y) < Math.min(r.size, size) * 0.5)
    if (row) row.items.push(item)
    else rows.push({ y, size, items: [item] })
  }
  rows.sort((a, b) => b.y - a.y) // PDF y grows upwards: top of the page first
  const lines: string[] = []
  let previous: Row | null = null
  for (const row of rows) {
    if (previous && previous.y - row.y > Math.max(previous.size, row.size) * 1.9) lines.push('')
    const sorted = [...row.items].sort((a, b) => a.transform[4] - b.transform[4])
    let line = ''
    let end: number | null = null
    for (const item of sorted) {
      const x = item.transform[4]
      if (end !== null) {
        const gap = x - end
        // Any visible gap is at least one space (so "23" and "15" never join into "2315").
        if (gap > row.size * 0.15 && !line.endsWith(' ') && !item.str.startsWith(' ')) {
          line += ' '.repeat(Math.min(12, Math.max(1, Math.round(gap / (row.size * 0.3)))))
        }
      }
      line += item.str
      end = x + item.width
    }
    lines.push(line.replace(/\s+$/, ''))
    previous = row
  }
  return lines
}
