import { useMemo, useState } from 'react'
import { X, Check, AlertTriangle, FileDown, Save, ImageUp, Info, ChevronRight, ChevronDown } from 'lucide-react'
import { useStore } from '../../store'
import { useT } from '../../i18n'
import { validateProject, countActiveIssues, type ValidationIssue } from '../../lib/validation'
import { defaultControlLabel } from '../../lib/courseUtils'
import type { Project } from '../../types'

interface Props {
  onClose: () => void
  onExportIof: (version: '2.0' | '3.0') => void
  onSaveProject: () => void
  onReplaceMap: () => void
}

const CRITERION_LABELS: Record<string, string> = {
  'no-start': 'validation.noStart',
  'no-finish': 'validation.noFinish',
  'no-controls': 'validation.noControls',
  'start-not-first': 'validation.startNotFirst',
  'finish-not-last': 'validation.finishNotLast',
  'duplicate-in-course': 'validation.duplicateInCourse',
  'duplicate-codes': 'validation.duplicateCodes',
  'controls-close': 'validation.controlsClose',
  'unused-controls': 'validation.unusedControls',
  'missing-descriptions': 'validation.missingDescriptions',
  'dog-leg': 'validation.dogLeg',
  'leg-crossing': 'validation.legCrossing',
  'control-on-leg': 'validation.controlOnLeg',
  'no-classes': 'validation.noClasses',
  'class-invalid-course': 'validation.classInvalidCourse',
  'short-legs': 'validation.shortLegs',
  'long-legs': 'validation.longLegs',
  'parallel-legs': 'validation.parallelLegs',
  'missing-map-issue': 'validation.missingMapIssue',
}

function fmtDist(m: number): string {
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`
}

function formatIssue(id: string, issue: ValidationIssue, project: Project): string {
  const cname = (cid: string) => project.courses.find(c => c.id === cid)?.name ?? '?'
  const ccode = (cid: string) => {
    const ctrl = project.controls.find(c => c.id === cid)
    return ctrl ? defaultControlLabel(ctrl) : '?'
  }

  switch (id) {
    case 'no-start': case 'no-finish': case 'no-controls':
    case 'start-not-first': case 'finish-not-last':
    case 'no-classes': case 'missing-map-issue':
      return cname(issue.courseId!)
    case 'duplicate-in-course':
      return `${cname(issue.courseId!)} — ${ccode(issue.controlId!)}`
    case 'duplicate-codes':
      return `${ccode(issue.controlId!)} / ${ccode(issue.controlId2!)}`
    case 'controls-close':
      return `${ccode(issue.controlId!)} ↔ ${ccode(issue.controlId2!)} (${fmtDist(issue.distanceM!)})`
    case 'unused-controls': case 'missing-descriptions':
      return ccode(issue.controlId!)
    case 'dog-leg':
      return `${cname(issue.courseId!)} — ${ccode(issue.controlId!)} → ${ccode(issue.controlId2!)} → ${ccode(issue.controlId!)}`
    case 'leg-crossing': {
      const course = project.courses.find(c => c.id === issue.courseId)
      if (!course) return '?'
      const i = issue.legIndex!, j = issue.legIndex2!
      const a = ccode(course.controls[i]?.controlId), b = ccode(course.controls[i + 1]?.controlId)
      const c = ccode(course.controls[j]?.controlId), d = ccode(course.controls[j + 1]?.controlId)
      return `${cname(issue.courseId!)} — ${a}→${b} × ${c}→${d}`
    }
    case 'control-on-leg':
      return `${ccode(issue.controlId!)} — ${cname(issue.courseId!)} (${fmtDist(issue.distanceM!)})`
    case 'class-invalid-course': {
      const cls = project.classes.find(c => c.id === issue.controlId)
      return cls?.name ?? '?'
    }
    case 'short-legs': case 'long-legs':
      return `${cname(issue.courseId!)} — ${ccode(issue.controlId!)} → ${ccode(issue.controlId2!)} (${fmtDist(issue.distanceM!)})`
    case 'parallel-legs':
      return `${cname(issue.courseId!)} / ${cname(issue.courseId2!)} — ${ccode(issue.controlId!)} → ${ccode(issue.controlId2!)}`
    default:
      return issue.key
  }
}

const SEV_ICON = {
  error: <AlertTriangle size={12} className="text-red-500 shrink-0" />,
  warning: <AlertTriangle size={12} className="text-amber-500 shrink-0" />,
  info: <Info size={12} className="text-blue-400 shrink-0" />,
}

const SEV_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 }

export function ValidationDialog({ onClose, onExportIof, onSaveProject, onReplaceMap }: Props) {
  const project = useStore(s => s.project!)
  const isViewer = useStore(s => s.projectRole === 'viewer' || !!s.project?.locked)
  const ignoredCriteria = useStore(s => s.editor.validationIgnoredCriteria)
  const ignoredInstances = useStore(s => s.editor.validationIgnoredInstances)
  const toggleIgnoreCriterion = useStore(s => s.toggleIgnoreCriterion)
  const toggleIgnoreInstance = useStore(s => s.toggleIgnoreInstance)
  const requestCenterOnControl = useStore(s => s.requestCenterOnControl)
  const setSelectedCourse = useStore(s => s.setSelectedCourse)
  const t = useT()

  const result = useMemo(() => validateProject(project), [project])
  const activeCount = useMemo(
    () => countActiveIssues(result, ignoredCriteria, ignoredInstances),
    [result, ignoredCriteria, ignoredInstances],
  )
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    for (const c of result.criteria) if (c.issues.length > 0 && c.severity !== 'info') initial.add(c.id)
    return initial
  })

  const toggleExpand = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const handleClickIssue = (issue: ValidationIssue) => {
    if (issue.courseId) setSelectedCourse(issue.courseId)
    if (issue.controlId) requestCenterOnControl(issue.controlId)
    onClose()
  }

  const sorted = [...result.criteria].sort((a, b) => {
    const sd = SEV_ORDER[a.severity] - SEV_ORDER[b.severity]
    if (sd !== 0) return sd
    const ad = a.issues.length > 0 ? 0 : 1
    const bd = b.issues.length > 0 ? 0 : 1
    return ad - bd
  })

  const btnCls = "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors"

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-800">{t('validation.title')}</h2>
            {activeCount === 0
              ? <span className="flex items-center gap-1 text-[10px] font-medium text-green-600 bg-green-50 rounded-full px-2 py-0.5"><Check size={10} />{t('validation.allPassed')}</span>
              : <span className="flex items-center gap-1 text-[10px] font-medium text-amber-600 bg-amber-50 rounded-full px-2 py-0.5"><AlertTriangle size={10} />{t('validation.issues', { count: String(activeCount) })}</span>
            }
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        {/* Export buttons */}
        <div className="flex flex-wrap gap-1.5 px-4 py-2.5 border-b border-gray-100 shrink-0">
          <button onClick={() => { onSaveProject(); onClose() }} className={`${btnCls} text-gray-700 hover:bg-gray-100 border border-gray-200`}>
            <Save size={14} />{t('header.saveOco')}
          </button>
          <button onClick={() => onExportIof('3.0')} className={`${btnCls} text-white bg-orange-600 hover:bg-orange-700`}>
            <FileDown size={14} />{t('header.exportIofV3')}
          </button>
          <button onClick={() => onExportIof('2.0')} className={`${btnCls} text-gray-700 hover:bg-gray-100 border border-gray-200`}>
            <FileDown size={14} />{t('header.exportIofV2')}
          </button>
          {!isViewer && (
            <button onClick={() => { onReplaceMap(); onClose() }} className={`${btnCls} text-gray-700 hover:bg-gray-100 border border-gray-200`}>
              <ImageUp size={14} />{t('header.replaceMap')}
            </button>
          )}
        </div>

        {/* Criteria list */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {sorted.map(c => {
            const isIgnored = ignoredCriteria.includes(c.id)
            const has = c.issues.length > 0
            const isExp = expanded.has(c.id) && has
            const ignoredSet = new Set(ignoredInstances)
            const activeInCriterion = isIgnored ? 0 : c.issues.filter(i => !ignoredSet.has(i.key)).length

            return (
              <div key={c.id} className={isIgnored ? 'opacity-40' : ''}>
                <div className="flex items-center gap-1.5 py-1.5 group">
                  {has ? (
                    <button onClick={() => toggleExpand(c.id)} className="p-0.5 text-gray-400 hover:text-gray-600">
                      {isExp ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                  ) : (
                    <span className="p-0.5"><Check size={12} className="text-green-500" /></span>
                  )}

                  {has && SEV_ICON[c.severity]}

                  <button
                    onClick={() => has && toggleExpand(c.id)}
                    className={`flex-1 text-left text-xs ${has ? 'text-gray-700' : 'text-gray-400'}`}
                  >
                    {t(CRITERION_LABELS[c.id] ?? c.id)}
                    {has && <span className="ml-1 text-gray-400">({activeInCriterion})</span>}
                  </button>

                  {has && (
                    <label className="flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity">
                      <input
                        type="checkbox"
                        checked={isIgnored}
                        onChange={() => toggleIgnoreCriterion(c.id)}
                        className="w-3 h-3 accent-gray-400"
                      />
                      {t('validation.skip')}
                    </label>
                  )}
                </div>

                {isExp && (
                  <div className="ml-5 border-l-2 border-gray-100 pl-3 mb-1">
                    {c.issues.map(issue => {
                      const iIgnored = ignoredSet.has(issue.key)
                      return (
                        <div key={issue.key} className={`flex items-center gap-2 py-1 ${iIgnored ? 'opacity-40' : ''}`}>
                          <button
                            onClick={() => handleClickIssue(issue)}
                            className={`flex-1 text-left text-[11px] hover:text-orange-600 transition-colors ${iIgnored ? 'line-through text-gray-400' : 'text-gray-600'}`}
                            title={t('validation.clickToLocate')}
                          >
                            {formatIssue(c.id, issue, project)}
                          </button>
                          <input
                            type="checkbox"
                            checked={iIgnored}
                            onChange={() => toggleIgnoreInstance(issue.key)}
                            className="w-3 h-3 accent-gray-400 shrink-0"
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
