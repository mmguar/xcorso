import { Map } from 'lucide-react'
import { useT, useLocale } from '../i18n'
import type { ReactNode } from 'react'

interface Props { onBack: () => void }

const linkClass = 'text-orange-600 underline hover:text-orange-800'

function rich(s: string, tags: Record<string, (content: string) => ReactNode>): ReactNode[] {
  const parts: ReactNode[] = []
  const rest = s
  let key = 0
  const re = /<(\w+)>(.*?)<\/\1>/g
  let m: RegExpExecArray | null
  let last = 0
  while ((m = re.exec(rest)) !== null) {
    if (m.index > last) parts.push(rest.slice(last, m.index))
    const fn = tags[m[1]]
    parts.push(fn ? <span key={key++}>{fn(m[2])}</span> : m[2])
    last = m.index + m[0].length
  }
  if (last < rest.length) parts.push(rest.slice(last))
  return parts
}

export function AboutPage({ onBack }: Props) {
  const t = useT()
  const { locale } = useLocale()
  const termsUrl = locale === 'en' ? '/terms.html' : `/terms-${locale}.html`

  const featureKeys = [
    'about.feat.loadMaps', 'about.feat.isom', 'about.feat.courseTypes',
    'about.feat.placeControls', 'about.feat.multiCourse', 'about.feat.clueSheets',
    'about.feat.annotations', 'about.feat.overlays', 'about.feat.layout',
    'about.feat.overprint', 'about.feat.exportPdf', 'about.feat.exportXml',
    'about.feat.sync',
  ] as const

  const missingKeys = [
    'about.miss.geo', 'about.miss.disciplines', 'about.miss.more',
  ] as const

  return (
    <div className="flex flex-col items-center h-dvh bg-gray-50 px-6 py-10 gap-8 overflow-y-auto">
      <div className="flex flex-col items-center gap-3 shrink-0">
        <h1 className="text-2xl font-bold text-gray-900">xcorso</h1>
      </div>

      <article className="w-full max-w-2xl bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-8 flex flex-col gap-6 text-gray-700 text-[15px] leading-relaxed">
        <section className="flex flex-col gap-3">
          <p>{t('about.intro1')}</p>
          <p>{t('about.intro2')}</p>
          <p>{t('about.intro3')}</p>
        </section>
        
        <section>
          <p>
            {rich(t('about.tryDemo'), {
              demo: c => <a href="/app?demo" className={linkClass}>{c}</a>,
            })}
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-2">{t('about.features')}</h2>
          <ul className="list-disc pl-5 flex flex-col gap-1.5">
            {featureKeys.map(k => <li key={k}>{t(k)}</li>)}
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-2">{t('about.missing')}</h2>
          <ul className="list-disc pl-5 flex flex-col gap-1.5 text-gray-500">
            {missingKeys.map(k => <li key={k}>{t(k)}</li>)}
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <p>
            {rich(t('about.feedback'), {
              gh: c => <a href="https://github.com/mmguar/xcorso/issues" target="_blank" rel="noopener noreferrer" className={linkClass}>{c}</a>,
            })}
          </p>
          <p>
            {rich(t('about.contact'), {
              email: c => <a href={`mailto:${c}`} className={linkClass}>{c}</a>,
            })}
          </p>
        </section>


        <section className="flex flex-col gap-3 border-t border-gray-100 pt-6">
          <p>
            {rich(t('about.credits'), {
              ocad: c => <a href="https://github.com/perliedman/ocad2geojson" target="_blank" rel="noopener noreferrer" className={linkClass}>{c}</a>,
            })}
          </p>
          <p>
            {rich(t('about.privacy2'), {
              terms: c => <a href={termsUrl} target="_blank" rel="noopener" className={linkClass}>{c}</a>,
            })}
          </p>
          <p>
            {rich(t('about.source'), {
              gh: c => <a href="https://github.com/mmguar/xcorso" target="_blank" rel="noopener noreferrer" className={linkClass}>{c}</a>,
            })}
          </p>
        </section>

        <div className="flex gap-4 text-sm border-t border-gray-100 pt-6">
          <a href={termsUrl} target="_blank" rel="noopener" className={linkClass}>
            {t('about.terms')}
          </a>

        </div>
      </article>

      <button
        onClick={onBack}
        className="text-sm text-gray-500 hover:text-orange-600 transition-colors shrink-0 pb-4"
      >
        {t('app.backHome')}
      </button>
    </div>
  )
}
