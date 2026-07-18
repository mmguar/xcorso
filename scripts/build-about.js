import { readFileSync, writeFileSync } from 'fs'

const TAGS = {
  gh: '<a href="https://github.com/mmguar/xcorso/issues" target="_blank" rel="noopener noreferrer">',
  email: '<a href="mailto:mmg@xcorso.it">',
  ocad: '<a href="https://github.com/perliedman/ocad2geojson" target="_blank" rel="noopener noreferrer">',
  terms: '<a href="/terms.html">',
  demo: '<a href="/app?demo">',
}
const SOURCE_TAG = { gh: '<a href="https://github.com/mmguar/xcorso" target="_blank" rel="noopener noreferrer">' }

function resolve(s, tagMap = TAGS) {
  return s.replace(/<(\w+)>(.*?)<\/\1>/g, (_, tag, content) => {
    const open = tagMap[tag] || TAGS[tag] || ''
    return open ? `${open}${content}</a>` : content
  })
}

const en = JSON.parse(readFileSync('src/i18n/en.json', 'utf8'))
const t = k => en[k] || k

const feats = [
  'about.feat.loadMaps', 'about.feat.isom', 'about.feat.courseTypes',
  'about.feat.placeControls', 'about.feat.multiCourse', 'about.feat.clueSheets',
  'about.feat.annotations', 'about.feat.overlays', 'about.feat.layout',
  'about.feat.overprint', 'about.feat.exportPdf', 'about.feat.exportXml',
  'about.feat.sync',
]
const missing = ['about.miss.geo', 'about.miss.disciplines', 'about.miss.more']

const li = keys => keys.map(k => `          <li>${t(k)}</li>`).join('\n')

const template = readFileSync('static/about.template.html', 'utf8')
const html = template
  .replace('{{intro1}}', t('about.intro1'))
  .replace('{{intro2}}', t('about.intro2'))
  .replace('{{intro3}}', t('about.intro3'))
  .replace('{{tryDemo}}', resolve(t('about.tryDemo')))
  .replace('{{features}}', t('about.features'))
  .replace('{{featureList}}', li(feats))
  .replace('{{missing}}', t('about.missing'))
  .replace('{{missingList}}', li(missing))
  .replace('{{feedback}}', resolve(t('about.feedback')))
  .replace('{{contact}}', resolve(t('about.contact')))
  .replace('{{credits}}', resolve(t('about.credits')))
  .replace('{{privacy}}', resolve(t('about.privacy2')))
  .replace('{{source}}', resolve(t('about.source'), SOURCE_TAG))
  .replace('{{terms}}', t('about.terms'))

writeFileSync('public/about.html', html)
console.log('public/about.html generated from en.json')
