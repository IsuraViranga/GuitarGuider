// Text helpers that must work for Sinhala (and any other Unicode script), not just English.

/**
 * Makes two strings comparable for search. Sinhala conjuncts such as ශ්‍රී contain an invisible
 * zero-width joiner (U+200D) that some keyboards insert and others don't, so it is removed,
 * and composed/decomposed forms of the same letter are unified (NFC).
 */
export function normalizeForSearch(text: string): string {
  return text.normalize('NFC').replace(/[‌‍]/g, '').trim().toLowerCase()
}

/**
 * Decodes an uploaded text file. Windows Notepad may save Sinhala as UTF-16 ("Unicode"),
 * which is recognised by its byte-order mark; everything else must be valid UTF-8.
 * Returns null when the bytes are not readable text.
 */
export function decodeTextFile(bytes: ArrayBuffer): string | null {
  const view = new Uint8Array(bytes)
  const encoding =
    view[0] === 0xff && view[1] === 0xfe ? 'utf-16le' : view[0] === 0xfe && view[1] === 0xff ? 'utf-16be' : 'utf-8'
  try {
    // The decoder drops a leading byte-order mark by default.
    return new TextDecoder(encoding, { fatal: true }).decode(view).normalize('NFC')
  } catch {
    return null
  }
}

const SINHALA = /[\u0D80-\u0DFF]/
/** Vowel signs and the virama: in real Sinhala text they always follow a letter, never start a word. */
const STARTS_WITH_SIGN = /^[\u0DCA-\u0DDF\u0DF2\u0DF3]/
/** Digits and symbols that do not belong in Sinhala lyrics (normal end punctuation like , . ! ? is fine). */
const FOREIGN = /[0-9"*#$%&+/<=>@[\]\\^_`{|}~]|^[!:;?.,'-]+$/

/**
 * Words of a Sinhala lyrics line that look damaged: some PDFs store Sinhala letters in a broken
 * way, so reading their text gives symbols ("!", "0", "*") or a lone vowel sign instead of
 * letters. Returns [] for lines without Sinhala.
 */
export function damagedSinhalaWords(line: string): string[] {
  const words = line.trim().split(/\s+/).filter(Boolean)
  if (!words.some((word) => SINHALA.test(word))) return []
  return words.filter((word) => FOREIGN.test(word) || STARTS_WITH_SIGN.test(word))
}
