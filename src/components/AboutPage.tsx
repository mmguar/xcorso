import { Map } from 'lucide-react'
import { useT } from '../i18n'

interface Props { onBack: () => void }

const linkClass = 'text-orange-600 underline hover:text-orange-800'

export function AboutPage({ onBack }: Props) {
  const t = useT()
  return (
    <div className="flex flex-col items-center h-dvh bg-gray-50 px-6 py-10 gap-8 overflow-y-auto">
      <div className="flex flex-col items-center gap-3 shrink-0">
        <div className="w-16 h-16 bg-orange-600 rounded-2xl flex items-center justify-center shadow-lg">
          <Map size={32} className="text-white" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">xcorso</h1>
      </div>

      <article className="w-full max-w-2xl bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-8 flex flex-col gap-6 text-gray-700 text-[15px] leading-relaxed">
        <section className="flex flex-col gap-3">
          <p>
            xcorso is a tool for orienteering course planning. It aims to make course setting more
            approachable and enjoyable.
          </p>
          <p>
            To achieve that, it is or aims to be intuitive, multi-platform, mobile-ready, free, and
            open source. Compared to other course planning tools, it is definitely not as
            feature-rich, but it should cover the most common orienteering events.
          </p>
          <p>
            It can be used locally without sharing any data, or users can sign in to sync projects
            across devices.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-2">Features</h2>
          <ul className="list-disc pl-5 flex flex-col gap-1.5">
            <li>Load maps from OCAD, PDF, and image files</li>
            <li>Organize ISOM 2017-2 and ISSprOM 2019 events</li>
            <li>Linear and Score-O courses</li>
            <li>Place controls on the map</li>
            <li>Design multiple courses with butterfly loops and map exchanges</li>
            <li>Pick control description and generate clue sheets</li>
            <li>Add out-of-bounds areas, crossing points, and more</li>
            <li>Add scale bars, custom text and images</li>
            <li>Layout the final print in a WYSIWYG editor</li>
            <li>Overprint and IOF overprint support</li>
            <li>Export PDF maps</li>
            <li>Export courses to IOF XML for race-day use</li>
            <li>Sync projects across devices</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-2">Missing features</h2>
          <ul className="list-disc pl-5 flex flex-col gap-1.5 text-gray-500">
            <li>Geolocalized maps</li>
            <li>Other orienteering disciplines (Ski-O, MTB-O, Trail-O)</li>
            <li>Taped routes and funnels</li>
            <li>Many more!</li>
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <p>
            If you wish to suggest a feature or report a bug, you can do so by opening an issue on{' '}
            <a
              href="https://github.com/mmguar/xcorso/issues"
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              GitHub
            </a>{' '}
            or emailing me. Don&apos;t forget that the project is open source, so you can also
            contribute directly! I would warmly welcome any development.
          </p>
          <p>
            I would love to hear from you no matter what — drop me a line at{' '}
            <a href="mailto:mmg@xcorso.it" className={linkClass}>
              mmg@xcorso.it
            </a>
            .
          </p>
        </section>

        <section className="flex flex-col gap-3 border-t border-gray-100 pt-6">
          <p>
            Finally, there is one library that made this entire project possible:{' '}
            <a
              href="https://github.com/perliedman/ocad2geojson"
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              ocad2geojson
            </a>
            .
          </p>
          <p>
            I have tried to respect your privacy as much as possible. If you do not want to use the sync feature, we only collect anonymized error data through Sentry.
            If you choose to login and sync, the only personal information we store is your email (but your courses will be uploaded). See the  <a href="/terms.html" target="_blank" rel="noopener" className={linkClass}>
            {t('terms of service')}</a> for a more complete picture.
          </p>
          <p>
            Find the source code for xcorso at{' '}
            <a
              href="https://github.com/mmguar/xcorso"
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              github.com/mmguar/xcorso
            </a>
            . It is distributed under the AGPL 3.0 license.
          </p>
        </section>

        <div className="flex gap-4 text-sm border-t border-gray-100 pt-6">
          <a href="/terms.html" target="_blank" rel="noopener" className={linkClass}>
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
