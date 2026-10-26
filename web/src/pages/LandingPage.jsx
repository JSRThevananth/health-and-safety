import { Link } from 'react-router-dom'
import Brand from '../components/Brand.jsx'
import ThemeToggle from '../components/ThemeToggle.jsx'
import HeroImage from '../components/HeroImage.jsx'

/*
 * Declared as functions, not const arrows: FEATURES below references them at module
 * scope, which a const would hit in its temporal dead zone.
 */
const ico = {
  width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
}

function ClipboardIcon() {
  return <svg {...ico}><path d="M9 4h6v3H9zM7 5H5v15h14V5h-2" /><path d="M9 12h6M9 16h4" /></svg>
}
function CameraIcon() {
  return <svg {...ico}><path d="M3 8h3l2-2h8l2 2h3v11H3z" /><circle cx="12" cy="13" r="3.4" /></svg>
}
function CheckIcon() {
  return <svg {...ico}><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.5 2.5 5-5.5" /></svg>
}
function BellIcon() {
  return <svg {...ico}><path d="M18 15V10a6 6 0 1 0-12 0v5l-2 3h16z" /><path d="M10 21h4" /></svg>
}
function RepeatIcon() {
  return <svg {...ico}><path d="M4 9a5 5 0 0 1 5-5h10M20 15a5 5 0 0 1-5 5H5" /><path d="M17 1l3 3-3 3M7 17l-3 3 3 3" /></svg>
}
function ChartIcon() {
  return <svg {...ico}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
}

const FEATURES = [
  {
    title: 'Checklists that fit each unit',
    body: 'Start from a 303-point airline catering standard, then let every unit enable, reword, reorder or add items. Published versions are frozen, so a signed inspection always reads exactly as it was completed.',
    icon: ClipboardIcon,
  },
  {
    title: 'Evidence as you walk',
    body: 'Capture photos straight from the phone against any item, annotate the hazard, and keep working where there is no signal — cold rooms, racking aisles and the apron included.',
    icon: CameraIcon,
  },
  {
    title: 'Findings that get closed',
    body: 'Every finding becomes a tracked corrective action with an owner, a due date and escalation. Closure needs verification evidence, giving you the before-and-after pair auditors ask for.',
    icon: CheckIcon,
  },
  {
    title: 'Alerts to the right people',
    body: 'Each unit keeps its own recipient list, so one station never receives another station report. Repeat and critical findings raise an immediate summary to the responsible administrator.',
    icon: BellIcon,
  },
  {
    title: 'Repeat risk, surfaced',
    body: 'The same item failing month after month is a stronger signal than a single bad day. Recurring findings are detected across versions and units, even where the wording has been localised.',
    icon: RepeatIcon,
  },
  {
    title: 'Monthly board reporting',
    body: 'A PDF for every unit and the group, with trends, severity mix and a ranked comparison — delivered automatically to the distribution list you control.',
    icon: ChartIcon,
  },
]

const STATS = [
  { value: '303', label: 'Checklist points', caption: 'across 16 inspection sections' },
  { value: '19', label: 'Areas covered', caption: 'hot kitchen through to apron' },
  { value: '100%', label: 'Audit traceable', caption: 'every record signed and versioned' },
]

export default function LandingPage() {
  return (
    <div className="landing">
      <header className="landing__nav">
        <div className="landing__nav-inner">
          <Brand />
          <nav className="landing__nav-actions">
            <a className="link-quiet" href="#capabilities">Capabilities</a>
            <a className="link-quiet" href="#standard">Standard</a>
            <ThemeToggle />
            <Link className="btn btn--primary btn--sm" to="/app">Sign in</Link>
          </nav>
        </div>
      </header>

      <section className="hero">
        <div className="hero__inner">
          <div className="hero__copy">
            <span className="eyebrow">YUL · Health &amp; safety</span>
            <h1>
              Every inspection,<br />
              <span className="hero__accent">audit ready.</span>
            </h1>
            <p className="lede">
              Health &amp; safety inspection for YUL catering —
              checklists, photographic evidence, tracked corrective actions
              and reporting.
            </p>
            <div className="hero__cta">
              <Link className="btn btn--primary" to="/app">Open the platform</Link>
              <a className="btn btn--ghost" href="#capabilities">See how it works</a>
            </div>
            <ul className="hero__stats">
              {STATS.map((stat) => (
                <li key={stat.label}>
                  <strong>{stat.value}</strong>
                  <span>{stat.label}</span>
                  <small>{stat.caption}</small>
                </li>
              ))}
            </ul>
          </div>

          <div className="hero__media">
            <HeroImage
              slot="1"
              className="hero__media-main"
              alt="Personal protective equipment laid out on a workbench: safety boots, work gloves, a two-way radio, ear defenders, safety glasses, a hard hat and a high-visibility vest"
              caption="Every point, every shift"
            />
            <HeroImage
              slot="2"
              className="hero__media-inset"
              alt="A health and safety inspector with a clipboard talking to a colleague on the production floor"
            />
          </div>
        </div>
      </section>

      <section className="section" id="capabilities">
        <div className="section__inner">
          <header className="section__head">
            <span className="eyebrow">Capabilities</span>
            <h2>Built around how inspections actually happen</h2>
            <p className="lede lede--center">
              Designed for the floor first — long checklists, gloved hands, poor signal —
              and for the auditor second.
            </p>
          </header>

          <div className="feature-grid">
            {FEATURES.map(({ title, body, icon: Icon }) => (
              <article className="feature" key={title}>
                <span className="feature__icon" aria-hidden="true"><Icon /></span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--alt" id="standard">
        <div className="section__inner section__inner--split">
          <div>
            <span className="eyebrow">The standard</span>
            <h2>Sixteen sections. Three hundred and three checks.</h2>
            <p className="lede">
              The library ships with the full airline catering health &amp; safety
              inspection standard — from PPE and emergency preparedness through hot
              production, warehouse racking, potwash and dishwash, to the apron and
              galley. Every unit tailors its own copy without breaking group reporting.
            </p>
            <Link className="btn btn--primary" to="/app">Start an inspection</Link>
          </div>
          <ul className="section-list">
            {[
              ['01', 'General health & safety', '37 checks'],
              ['02', 'Kitchen — hot production', '34 checks'],
              ['05', 'Warehouse', '24 checks'],
              ['10', 'Outbound & apron', '24 checks'],
              ['11', 'Commissary / galley', '24 checks'],
              ['12', 'Chemical safety', '13 checks'],
            ].map(([no, name, count]) => (
              <li key={no}>
                <span className="section-list__no">{no}</span>
                <span className="section-list__name">{name}</span>
                <span className="section-list__count">{count}</span>
              </li>
            ))}
            <li className="section-list__more">+ 10 further sections</li>
          </ul>
        </div>
      </section>

      <footer className="landing__footer">
        <div className="landing__footer-inner">
          <Brand size="sm" />
          <p className="muted small">
            Health &amp; safety inspection management for airline catering.
          </p>
        </div>
      </footer>
    </div>
  )
}
