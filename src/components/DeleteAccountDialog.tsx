import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useStore } from '../store'
import { useT } from '../i18n'
import { listProjects, saveProject } from '../lib/persistence'
import { deleteAccount, fetchCloudProjects, downloadProject, type CloudProjectMeta } from '../lib/sync'
import { detachCloudCopies } from '../lib/logoutPurge'

/**
 * Account-deletion confirmation. Cloud data is erased permanently; copies
 * already on this device become ordinary local projects. Cloud projects with
 * no local copy would be lost, so the dialog lists them and offers to
 * download them first — only after every download succeeds is the account
 * deleted, so a failure never destroys anything.
 */
export function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  const setCloudUser = useStore(s => s.setCloudUser)
  const [missing, setMissing] = useState<CloudProjectMeta[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([listProjects(), fetchCloudProjects()])
      .then(([local, cloud]) => {
        const localCloudIds = new Set(local.map(p => p.sync?.cloudId).filter(Boolean))
        setMissing(cloud.filter(c => !localCloudIds.has(c.id)))
      })
      .catch(() => setMissing([]))
  }, [])

  async function doDelete(downloadFirst: boolean) {
    setBusy(true)
    setError(null)
    try {
      if (downloadFirst) {
        for (const c of missing ?? []) {
          const result = await downloadProject(c.id, null)
          if (!result) {
            setBusy(false)
            setError(t('deleteAccount.downloadFailed', { name: c.name }))
            return
          }
          // No sync meta on purpose: the copy is born as a local project.
          await saveProject(c.id, result.project, result.mapData)
        }
      }
      if (!(await deleteAccount())) {
        setBusy(false)
        setError(t('deleteAccount.failed'))
        return
      }
      // Account gone server-side; keep every local copy as a local project.
      const detached = await detachCloudCopies()
      const { projectId } = useStore.getState()
      if (projectId && detached.includes(projectId)) {
        useStore.setState({ syncStatus: 'idle', versionHistory: [], projectRole: 'owner' })
      }
      setCloudUser(null)
      onClose()
    } catch {
      setBusy(false)
      setError(t('deleteAccount.failed'))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl p-5 w-96 flex flex-col gap-4">
        {missing === null || (busy && !error) ? (
          <div className="flex items-center justify-center py-6">
            <RefreshCw size={18} className="animate-spin text-orange-500" />
          </div>
        ) : (
          <>
            <h3 className="text-sm font-semibold text-gray-800">{t('deleteAccount.title')}</h3>
            <p className="text-xs text-gray-500">{t('deleteAccount.desc')}</p>
            {missing.length > 0 && (
              <div className="text-xs text-amber-700 bg-amber-50 rounded-lg p-3">
                <p className="font-medium mb-1">{t('deleteAccount.missingWarning', { count: missing.length })}</p>
                <ul className="list-disc list-inside">
                  {missing.map(c => <li key={c.id} className="truncate">{c.name}</li>)}
                </ul>
              </div>
            )}
            {error && <p className="text-red-500 text-xs">{error}</p>}
            <div className="flex flex-col gap-2">
              {missing.length > 0 && (
                <button onClick={() => doDelete(true)} className="px-3 py-2 text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg transition-colors">
                  {t('deleteAccount.downloadAndDelete')}
                </button>
              )}
              <button onClick={() => doDelete(false)} className={`px-3 py-2 text-sm rounded-lg transition-colors ${missing.length > 0 ? 'text-red-600 hover:bg-red-50' : 'font-medium text-white bg-red-600 hover:bg-red-700'}`}>
                {missing.length > 0 ? t('deleteAccount.deleteAnyway') : t('deleteAccount.delete')}
              </button>
              <button onClick={onClose} className="px-3 py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">
                {t('deleteAccount.cancel')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
