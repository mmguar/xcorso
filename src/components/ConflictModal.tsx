import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useStore } from '../store'
import { useT } from '../i18n'

function timeStr(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function summary(p: { controls: unknown[]; courses: unknown[]; meta: { name: string; updatedAt: string } }) {
  return { name: p.meta.name, updated: timeStr(p.meta.updatedAt), controls: p.controls.length, courses: p.courses.length }
}

export function ConflictModal() {
  const t = useT()
  const conflict = useStore(s => s.syncConflict)
  const project = useStore(s => s.project)
  const resolveConflict = useStore(s => s.resolveConflict)
  const [resolving, setResolving] = useState<'local' | 'remote' | null>(null)
  if (!conflict || !project) return null

  const local = summary(project)
  const remote = summary(conflict.remoteProject)

  async function handleResolve(keep: 'local' | 'remote') {
    setResolving(keep)
    await resolveConflict(keep)
    setResolving(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl p-5 w-96 flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-gray-800">{t('conflict.title')}</h3>
        <p className="text-xs text-gray-500">
          {t('conflict.desc')}
        </p>

        <div className="grid grid-cols-2 gap-3">
          {[{ label: t('conflict.local'), data: local, action: 'local' as const },
            { label: t('conflict.remote'), data: remote, action: 'remote' as const }].map(side => (
            <button
              key={side.action}
              onClick={() => handleResolve(side.action)}
              disabled={resolving !== null}
              className="border border-gray-200 hover:border-orange-400 rounded-xl p-3 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resolving === side.action ? (
                <div className="flex items-center justify-center py-3">
                  <RefreshCw size={16} className="animate-spin text-orange-500" />
                </div>
              ) : (
                <>
                  <div className="text-xs font-semibold text-gray-700 mb-2">{side.label}</div>
                  <div className="text-[10px] text-gray-500 space-y-0.5">
                    <div>{side.data.name}</div>
                    <div>{side.data.updated}</div>
                    <div>{t('conflict.controlsCourses', { controls: side.data.controls, courses: side.data.courses })}</div>
                  </div>
                </>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
