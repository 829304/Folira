import { SECTIONS } from '@/lib/sections'
import FeatItem from './FeatItem'
import { CodeIcon, SunIcon } from './Icons'

type Swatch = {
  name: string
  bg: string
  fg: string
  accent: string
  bgBorder?: string
}

// Decorative approximations picked to look right at card size. The real values
// live in packages/desktop/src/renderer/src/assets/themes/manifest.json, which
// the app reads for its own theme picker; these do not have to match it exactly.
// Keep the card grid and the "more" counter derived from the shipped total so
// a new theme cannot leave the page claiming the wrong remainder.
const TOTAL_THEMES = 36

const SWATCHES: Swatch[] = [
  { name: 'Light', bg: '#fff', fg: '#4d4d4d', accent: '#21b56f', bgBorder: '#e2e2e2' },
  { name: 'Dark', bg: '#282828', fg: '#cfcfcf', accent: '#409eff' },
  { name: 'GitHub Light', bg: '#fff', fg: '#1f2328', accent: '#0969da', bgBorder: '#d1d9e0' },
  { name: 'Claude Style', bg: '#faf9f5', fg: '#141413', accent: '#d97757', bgBorder: '#e2ddd2' },
  { name: 'Material Dark', bg: '#34393f', fg: '#abb2bf', accent: '#f48237' },
  { name: 'Ulysses', bg: '#f3f3f3', fg: '#656565', accent: '#0c8bba', bgBorder: '#e4e4e4' },
  { name: 'ONE Dark', bg: '#282c34', fg: '#9da5b4', accent: '#e06c75' }
]

export default function Themes() {
  return (
    <section className="block" id={SECTIONS.themes}>
      <div className="wrap">
        <div className="split rev">
          <div className="split-text">
            <div className="sec-head reveal">
              <span className="kicker">Themes</span>
              <h2 className="sec-title">Make it yours.</h2>
              <p className="sec-desc">
                {TOTAL_THEMES} built-in themes, light and dark. One choice sets the window chrome, the page and
                the syntax colours together — and every theme is plain CSS.
              </p>
            </div>
            <div className="feat-list">
              <FeatItem
                delay="d1"
                icon={<SunIcon />}
                title="Light and dark, in one list"
                description="Browse under two tabs, preview on hover, click to apply."
              />
              <FeatItem
                delay="d2"
                icon={<CodeIcon />}
                title="Author with plain CSS"
                description="No proprietary format. Know CSS? You can theme it."
              />
            </div>
          </div>
          <div className="reveal d2">
            <div className="theme-grid">
              {SWATCHES.map((s) => (
                <div className="swatch" key={s.name}>
                  <div className="pv" style={{ background: s.bg, color: s.fg }}>
                    <div className="t" style={{ color: s.accent }}>
                      {s.name.split(' ')[0]}
                    </div>
                    # Heading
                    <br />
                    **bold** _italic_
                    <br />
                    &gt; quote
                  </div>
                  <div className="meta">
                    <b>{s.name}</b>
                    <div className="dots">
                      <i
                        style={{
                          background: s.bg,
                          border: s.bgBorder ? `1px solid ${s.bgBorder}` : undefined
                        }}
                      />
                      <i style={{ background: s.accent }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="theme-more reveal d1">
              <span>+{TOTAL_THEMES - SWATCHES.length} more built-in themes</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
