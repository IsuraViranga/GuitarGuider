import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../app/usePageTitle'
import stagePhoto from '../assets/brand/melantha-stage.jpg'
import bassPhoto from '../assets/brand/melantha-bass-wide.jpg'
import { GuitarPick } from '../components/decor/GuitarPick'
import { HeroSlideshow, type Slide } from '../components/decor/HeroSlideshow'
import { Fretboard } from '../components/fretboard/Fretboard'
import { midiToNoteName } from '../music/pitch'
import { STANDARD_TUNING, STRING_NUMBERS } from '../music/tuning'
import styles from './HomePage.module.css'

const HERO_SLIDES: Slide[] = [
  {
    src: stagePhoto,
    alt: 'Melantha on stage with a microphone, under blue stage lights',
    caption: 'Every great player started with one note',
    focus: '50% 18%',
  },
  {
    src: bassPhoto,
    alt: 'Melantha smiling on stage, playing a bass guitar',
    caption: 'Play a little every day. Your music grows',
    focus: '58% 40%',
  },
]

const STRING_DESCRIPTIONS: Record<number, string> = {
  1: 'Thinnest string',
  6: 'Thickest string',
}

const STEPS: { title: string; text: string; icon: ReactNode }[] = [
  {
    title: 'Choose a song',
    text: 'Pick one from the list, or paste one from any chord website.',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M9 18V5l11-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="17" cy="16" r="3" />
      </svg>
    ),
  },
  {
    title: 'Tap Listen',
    text: 'Put your phone near the guitar. The app listens as you play.',
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" />
      </svg>
    ),
  },
  {
    title: 'Play along',
    text: 'Green means correct and the song moves on. Red shows what to fix.',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    ),
  },
]

const EXAMPLES = [
  { code: '13', meaning: 'string 1, fret 3' },
  { code: '60', meaning: 'string 6, open' },
  { code: '112', meaning: 'string 1, fret 12' },
  { code: '[40 32 23 12]', meaning: 'D chord: strum together' },
]

export function HomePage() {
  usePageTitle('')

  return (
    <div className="page stack">
      <section className={styles.hero} aria-labelledby="home-heading">
        <div className={styles.heroText}>
          <p className={styles.kicker}>Melantha Guitar Academy</p>
          <h1 id="home-heading" className={styles.title}>
            Learn guitar with <span>Melantha</span>
          </h1>
          <p className={styles.lead}>
            Pick a song, play along note by note or chord by chord, and the app listens and tells you how you are doing.
            Sinhala and English songs.
          </p>
          <div className="button-row">
            <Link className="button button-primary" to="/songs">
              <span aria-hidden="true">🎸</span> Start playing
            </Link>
            <Link className="button" to="/import">
              Add a song
            </Link>
          </div>
        </div>
        <HeroSlideshow slides={HERO_SLIDES} />
      </section>

      <section className={styles.section} aria-labelledby="how-heading">
        <p className={styles.kicker}>Three steps</p>
        <h2 id="how-heading" className={styles.sectionTitle}>
          How it works
        </h2>
        <ol className={styles.steps}>
          {STEPS.map((step, i) => (
            <li key={step.title} className={`card ${styles.step}`}>
              <span className={styles.stepIcon} aria-hidden="true">
                {step.icon}
                <span className={styles.stepNumber}>{i + 1}</span>
              </span>
              <span>
                <strong className={styles.stepTitle}>{step.title}</strong>
                <span className={styles.stepText}>{step.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className={`card ${styles.numbers}`} aria-labelledby="numbers-heading">
        <p className={styles.kicker}>Read the music</p>
        <h2 id="numbers-heading" className={styles.sectionTitle}>
          How the numbers work
        </h2>
        <p>
          Each note is one number. The <strong className={styles.stringWord}>first digit is the string</strong>, the{' '}
          <strong className={styles.fretWord}>rest is the fret</strong>. Fret 0 means play the string open, with no
          finger pressing it. A chord is several numbers in brackets, played together.
        </p>

        <div className={styles.anatomy}>
          <div className={styles.digits} aria-label="13 means string 1, fret 3" role="img">
            <span className={styles.digit}>
              <span className={`${styles.digitBox} ${styles.stringBox}`}>1</span>
              <span className={styles.digitLabel}>String</span>
            </span>
            <span className={styles.digit}>
              <span className={`${styles.digitBox} ${styles.fretBox}`}>3</span>
              <span className={styles.digitLabel}>Fret</span>
            </span>
          </div>
          <div className={styles.anatomyBoard}>
            <Fretboard positions={[{ stringNumber: 1, fret: 3 }]} tuning={STANDARD_TUNING} />
          </div>
        </div>

        <ul className={styles.examples}>
          {EXAMPLES.map((example) => (
            <li key={example.code} className={`${styles.example} ${example.code.startsWith('[') ? styles.wide : ''}`}>
              <code className={styles.exampleCode}>{example.code}</code>
              <span>{example.meaning}</span>
            </li>
          ))}
        </ul>

        <h3 className={styles.subTitle}>The six strings</h3>
        <ul className={styles.strings} aria-label="String numbers in standard tuning">
          {STRING_NUMBERS.map((stringNumber) => (
            <li key={stringNumber} className={styles.stringRow}>
              <span className={styles.stringNumber}>{stringNumber}</span>
              <span
                className={`${styles.stringLine} ${stringNumber >= 4 ? styles.wound : ''}`}
                style={{ height: `${1 + stringNumber * 0.6}px` }}
                aria-hidden="true"
              />
              <span className={styles.stringNote}>
                {midiToNoteName(STANDARD_TUNING.openStringMidi[stringNumber]).label}
                {STRING_DESCRIPTIONS[stringNumber] && (
                  <span className={styles.stringHint}>
                    <span className="visually-hidden">, </span>
                    {STRING_DESCRIPTIONS[stringNumber]}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>

        <p className={styles.sameSound}>
          <span aria-hidden="true">👂 </span>
          <strong>Good to know:</strong> the app checks the note you play by its sound. Some notes sound exactly the
          same on two strings: <code>10</code> and <code>25</code> are both E4. So always play on the string the
          fretboard shows. After a 30-second <Link to="/guitar-setup">guitar setup</Link>, the app also checks which string
          you used.
        </p>
      </section>

      <section className={styles.tips} aria-labelledby="tips-heading">
        <figure className={styles.tipsPhoto}>
          <img src={bassPhoto} alt="Melantha smiling on stage, playing a bass guitar" width={372} height={251} />
        </figure>
        <div className={styles.tipsBody}>
          <p className={styles.kicker}>Melantha&apos;s corner</p>
          <h2 id="tips-heading" className={styles.tipsTitle}>
            Practice tips
          </h2>
          <ol className={styles.tipList}>
            {TIPS.map((tip, i) => (
              <li key={tip.title} className={styles.tip}>
                <span className={styles.tipPick} aria-hidden="true">
                  <GuitarPick />
                  <span>{i + 1}</span>
                </span>
                <span>
                  <strong>{tip.title}</strong> {tip.text}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  )
}

const TIPS = [
  { title: 'Start slowly.', text: 'Use Note by note until every note turns green.' },
  { title: 'Then speed up.', text: 'Switch to Play through and keep the music flowing.' },
  { title: 'Tune first.', text: 'A guitar in tune makes every note easier to hear.' },
]
