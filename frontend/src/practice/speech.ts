// Spoken guidance: the next note is said aloud ("String 1, fret 3."), so the student can keep
// their eyes on the guitar. Uses the browser's built-in speech (Web Speech API); nothing is sent
// anywhere.

import { midiToNoteName } from '../music/pitch'
import type { SongNote } from '../songs/types'
import type { Feedback } from './practiceReducer'

const CHORD_NAME = /^([A-G])(#|b)?([^/]*)(?:\/([A-G])(#|b)?)?$/

/** How chord-chart spellings are said. Anything not listed is spelled out as written. */
const QUALITY_WORDS: Record<string, string> = {
  '': 'major', M: 'major', maj: 'major',
  m: 'minor', min: 'minor', '-': 'minor',
  '7': 'seven', dom7: 'seven', '9': 'nine', '11': 'eleven', '13': 'thirteen', '6': 'six', '5': 'five',
  maj7: 'major seven', M7: 'major seven', maj9: 'major nine',
  m7: 'minor seven', min7: 'minor seven', m6: 'minor six', m9: 'minor nine', m11: 'minor eleven',
  sus: 'sus four', sus2: 'sus two', sus4: 'sus four', '7sus4': 'seven sus four', '7sus2': 'seven sus two',
  dim: 'diminished', dim7: 'diminished seven', '°': 'diminished',
  aug: 'augmented', '+': 'augmented',
  add9: 'add nine', add2: 'add two', madd9: 'minor add nine',
  m7b5: 'half diminished', 'ø': 'half diminished',
}

function letter(name: string, accidental: string | undefined): string {
  if (accidental === '#') return `${name} sharp`
  if (accidental === 'b') return `${name} flat`
  return name
}

/** "Am" → "A minor", "F#7" → "F sharp seven", "C/G" → "C major over G". */
export function chordToSpeech(name: string): string {
  const match = CHORD_NAME.exec(name.trim())
  if (!match) return name
  const [, root, accidental, quality, bass, bassAccidental] = match
  const words = [letter(root, accidental), QUALITY_WORDS[quality] ?? quality.split('').join(' ')]
  if (bass) words.push('over', letter(bass, bassAccidental))
  return words.join(' ')
}

/** What to say for one step of the song. */
export function noteToSpeech(note: SongNote): string {
  if (note.chord) return note.chord.name ? `${chordToSpeech(note.chord.name)} chord.` : 'Strum the chord.'
  if (note.position) {
    const { stringNumber, fret } = note.position
    return fret === 0 ? `String ${stringNumber}, open.` : `String ${stringNumber}, fret ${fret}.`
  }
  const label = midiToNoteName(note.midi).label
  return `Note ${label.replace('#', ' sharp ')}.`
}

/**
 * What to say after a wrong note or chord (after the short error sound): what was wrong and what to
 * play instead. Strings 1 and 6 are both E, so a two-octave mistake means the wrong E string.
 */
export function correctionToSpeech(expected: SongNote, feedback: Feedback): string | null {
  if (feedback.kind === 'wrong-chord') {
    return expected.chord?.name ? `Wrong chord. Play ${chordToSpeech(expected.chord.name)}.` : 'Wrong chord. Try again.'
  }
  if (feedback.kind === 'wrong-string') {
    const what = noteToSpeech(expected)
    return `Wrong string. Play ${what[0].toLowerCase()}${what.slice(1)}`
  }
  if (feedback.kind !== 'incorrect') return null
  const string = expected.position?.stringNumber
  if (string === 1 && feedback.heardMidi === expected.midi - 24) return 'Wrong string. Use string 1, the thinnest string.'
  if (string === 6 && feedback.heardMidi === expected.midi + 24) return 'Wrong string. Use string 6, the thickest string.'
  const what = noteToSpeech(expected)
  return `Wrong note. Play ${what[0].toLowerCase()}${what.slice(1)}`
}

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

function englishVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices()
  return voices.find((v) => v.lang === 'en-GB') ?? voices.find((v) => v.lang.startsWith('en'))
}

/**
 * Says `text`, interrupting anything still being said (the newest note matters most).
 * `onStart`/`onEnd` let the listener ignore the microphone while the phone talks.
 */
export function speak(
  text: string,
  { onStart, onEnd, rate = 1 }: { onStart?: () => void; onEnd?: () => void; rate?: number } = {},
): void {
  if (!canSpeak()) return
  const synth = window.speechSynthesis
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'en-GB'
  utterance.rate = rate
  const voice = englishVoice()
  if (voice) utterance.voice = voice
  utterance.onstart = () => onStart?.()
  utterance.onend = () => onEnd?.()
  utterance.onerror = () => onEnd?.()
  synth.speak(utterance)
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel()
}
