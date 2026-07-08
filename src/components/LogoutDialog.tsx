import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useStore } from '../store'
import { useT } from '../i18n'
import { flushSave } from '../lib/persistence'
import { logout as cloudLogout } from '../lib/sync'
import { listCloudCopies, syncCloudCopy, purgeCloudCopies, type CloudCopy } from '../lib/logoutPurge'

/**
 * Sign-out confirmation: warns that cloud project copies are removed from
 * this device, lists unsynced ones, and offers to sync them first.
 * Logs out immediately (no dialog flash) when there is nothing to purge.
 */
export function LogoutDialog({ onClose, onLoggedOut }: { onClose: () => void; onLoggedOut: () => void }) {
  const t = useT()
  const [copies, setCopies] = useState<CloudCopy[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    flushSave()
      .then(listCloudCopies)
      .then(found => {
        if (found.length === 0) { doLogout() } else { setCopies(found) }
      })
      .catch(() => setCopies([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const unsynced = copies?.filter(c => c.unsynced) ?? []

  async function doLogout() {
    setBusy(true)
    await cloudLogout()
    const purged = await purgeCloudCopies()
    const { projectId } = useStore.getState()
    if (projectId && purged.includes(projectId)) {
      // The open project was purged — drop it from memory too, or the autosave
      // subscriber would resurrect it in IDB on the next mutation.
      useStore.setState({
        projectId: null, project: null, mapFileData: null, loadedMap: null,
        undoStack: [], redoStack: [], syncStatus: 'idle', versionHistory: [], projectRole: 'owner',
      })
    }
    useStore.getState().setCloudUser(null)
    onLoggedOut()
  }

  async function handleSyncAll() {
    setBusy(true)
    setError(null)
    for (const c of unsynced) {
      if (!(await syncCloudCopy(c.id))) {
        setBusy(false)
        setError(t('logout.syncFailed', { name: c.name }))
        return
      }
    }
    await doLogout()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl p-5 w-96 flex flex-col gap-4">
        {copies === null || (busy && !error) ? (
          <div className="flex items-center justify-center py-6">
            <RefreshCw size={18} className="animate-spin text-orange-500" />
          </div>
        ) : (
          <>
            <h3 className="text-sm font-semibold text-gray-800">{t('logout.title')}</h3>
            <p className="text-xs text-gray-500">{t('logout.desc', { count: copies.length })}</p>
            {unsynced.length > 0 && (
              <div className="text-xs text-amber-700 bg-amber-50 rounded-lg p-3">
                <p className="font-medium mb-1">{t('logout.unsyncedWarning')}</p>
                <ul className="list-disc list-inside">
                  {unsynced.map(c => <li key={c.id} className="truncate">{c.name}</li>)}
                </ul>
              </div>
            )}
            {error && <p className="text-red-500 text-xs">{error}</p>}
            <div className="flex flex-col gap-2">
              {unsynced.length > 0 && (
                <button onClick={handleSyncAll} className="px-3 py-2 text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg transition-colors">
                  {t('logout.syncAndSignOut')}
                </button>
              )}
              <button onClick={doLogout} className={`px-3 py-2 text-sm rounded-lg transition-colors ${unsynced.length > 0 ? 'text-red-600 hover:bg-red-50' : 'font-medium text-white bg-orange-600 hover:bg-orange-700'}`}>
                {unsynced.length > 0 ? t('logout.signOutAnyway') : t('logout.signOut')}
              </button>
              <button onClick={onClose} className="px-3 py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">
                {t('logout.cancel')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
