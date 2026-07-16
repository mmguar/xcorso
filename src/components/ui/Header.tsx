import { useEffect, useMemo, useRef, useState } from 'react'
import { Save, FileDown, Map, ChevronDown, Home, Plus, Cloud, CloudOff, RefreshCw, AlertTriangle, LogOut, LogIn, History, Share2, UserPlus, X, Eye, Lock, LockOpen, Check } from 'lucide-react'
import { useStore } from '../../store'
import { useT, LanguageSwitcher } from '../../i18n'
import { saveProjectFile, downloadBlob } from '../../lib/projectFile'
import { exportIofXml, exportIofXmlV2 } from '../../lib/iofExport'
import { listProjects, getSyncMeta } from '../../lib/persistence'
import type { ProjectSummary } from '../../lib/persistence'
import { addShare, removeShare, listShares, acceptTerms, TERMS_VERSION, type ShareEntry } from '../../lib/sync'
import { LogoutDialog } from '../LogoutDialog'
import { SPEC_LABEL_KEYS } from '../../lib/symbolSpec'
import { validateProject, countActiveIssues } from '../../lib/validation'
import { ValidationDialog } from './ValidationDialog'
import type { EventSpec, MapType } from '../../types'

const MAP_EXTENSIONS = new Set(['ocd', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp'])

interface Props { onGoHome: () => void; onLogin: () => void; guardLeave: (action: () => void) => void }

export function Header({ onGoHome, onLogin, guardLeave }: Props) {
  const t = useT()
  const project = useStore(s => s.project!)
  const projectId = useStore(s => s.projectId)
  const mapFileData = useStore(s => s.mapFileData)
  const updateProjectName = useStore(s => s.updateProjectName)
  const updateProjectSpec = useStore(s => s.updateProjectSpec)
  const switchProject = useStore(s => s.switchProject)
  const cloudUser = useStore(s => s.cloudUser)
  const syncStatus = useStore(s => s.syncStatus)
  const syncProject = useStore(s => s.syncProject)
  const setCloudUser = useStore(s => s.setCloudUser)
  const projectRole = useStore(s => s.projectRole)
  const locked = useStore(s => !!s.project?.locked)
  const toggleLocked = useStore(s => s.toggleLocked)
  const mapType = useStore(s => s.project!.map.type)
  const updateProjectMeta = useStore(s => s.updateProjectMeta)
  const isViewer = projectRole === 'viewer' || locked
  const isOwner = projectRole === 'owner'
  const canSync = mapType === 'ocad'
  const [eventInfoOpen, setEventInfoOpen] = useState(false)
  const [nameVal, setNameVal] = useState(project.meta.name)
  const [eventDate, setEventDate] = useState(project.meta.eventDate ?? '')
  const [organizer, setOrganizer] = useState(project.meta.organizer ?? '')
  const [club, setClub] = useState(project.meta.club ?? '')
  const [venue, setVenue] = useState(project.meta.venue ?? '')
  const eventInfoRef = useRef<HTMLDivElement>(null)
  const replaceMapFile = useStore(s => s.replaceMapFile)
  const saveSnapshot = useStore(s => s.saveSnapshot)
  const fetchVersionHistory = useStore(s => s.fetchVersionHistory)
  const restoreVersionAction = useStore(s => s.restoreVersion)
  const versionHistory = useStore(s => s.versionHistory)
  const [validationOpen, setValidationOpen] = useState(false)
  const mapInputRef = useRef<HTMLInputElement>(null)

  const [historyOpen, setHistoryOpen] = useState(false)
  const historyRef = useRef<HTMLDivElement>(null)

  const [shareOpen, setShareOpen] = useState(false)
  const [shares, setShares] = useState<ShareEntry[]>([])
  const [shareEmail, setShareEmail] = useState('')
  const [shareRole, setShareRole] = useState<'editor' | 'viewer'>('editor')
  const [shareError, setShareError] = useState<string | null>(null)
  const shareRef = useRef<HTMLDivElement>(null)
  const [confirmUnlock, setConfirmUnlock] = useState(false)
  const confirmUnlockRef = useRef<HTMLDivElement>(null)

  // Project switcher dropdown
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)
  // Was this project ever synced? Distinguishes "sync not applicable" from
  // "sync silently stopped because the map was replaced with a non-OCAD file".
  const [wasSynced, setWasSynced] = useState(false)
  useEffect(() => {
    let stale = false
    if (!projectId) return
    getSyncMeta(projectId).then(sm => { if (!stale) setWasSynced(!!sm) })
    return () => { stale = true }
  }, [projectId, canSync])
  const [otherProjects, setOtherProjects] = useState<ProjectSummary[]>([])
  const switcherRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!switcherOpen) return
    listProjects().then(all => setOtherProjects(all.filter(p => p.id !== projectId)))
    function handleClick(e: MouseEvent) {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setSwitcherOpen(false)
      }
    }
    document.addEventListener('pointerdown', handleClick)
    return () => document.removeEventListener('pointerdown', handleClick)
  }, [switcherOpen, projectId])

  useEffect(() => {
    if (!historyOpen) return
    fetchVersionHistory()
    function handleClick(e: MouseEvent) {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) setHistoryOpen(false)
    }
    document.addEventListener('pointerdown', handleClick)
    return () => document.removeEventListener('pointerdown', handleClick)
  }, [historyOpen, fetchVersionHistory])

  useEffect(() => {
    if (!confirmUnlock) return
    function handleClick(e: MouseEvent) {
      if (confirmUnlockRef.current && !confirmUnlockRef.current.contains(e.target as Node)) setConfirmUnlock(false)
    }
    document.addEventListener('pointerdown', handleClick)
    return () => document.removeEventListener('pointerdown', handleClick)
  }, [confirmUnlock])

  useEffect(() => {
    if (!shareOpen) return
    if (isOwner && projectId) {
      getSyncMeta(projectId).then(sm => {
        if (sm) listShares(sm.cloudId).then(r => setShares(r.shares))
      })
    }
    function handleClick(e: MouseEvent) {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) setShareOpen(false)
    }
    document.addEventListener('pointerdown', handleClick)
    return () => document.removeEventListener('pointerdown', handleClick)
  }, [shareOpen, isOwner, projectId])

  const ignoredCriteria = useStore(s => s.editor.validationIgnoredCriteria)
  const ignoredInstances = useStore(s => s.editor.validationIgnoredInstances)
  const validationResult = useMemo(() => validateProject(project), [project])
  const activeIssues = useMemo(
    () => countActiveIssues(validationResult, ignoredCriteria, ignoredInstances),
    [validationResult, ignoredCriteria, ignoredInstances],
  )

  function openEventInfo() {
    setNameVal(project.meta.name)
    setEventDate(project.meta.eventDate ?? '')
    setOrganizer(project.meta.organizer ?? '')
    setClub(project.meta.club ?? '')
    setVenue(project.meta.venue ?? '')
    setEventInfoOpen(true)
  }

  useEffect(() => {
    if (!eventInfoOpen) return
    function handleClick(e: MouseEvent) {
      if (eventInfoRef.current && !eventInfoRef.current.contains(e.target as Node)) setEventInfoOpen(false)
    }
    document.addEventListener('pointerdown', handleClick)
    return () => document.removeEventListener('pointerdown', handleClick)
  }, [eventInfoOpen])

  function commitEventInfo() {
    updateProjectName(nameVal)
    updateProjectMeta({
      eventDate: eventDate || undefined,
      organizer: organizer || undefined,
      club: club || undefined,
      venue: venue || undefined,
    })
    setEventInfoOpen(false)
  }

  async function handleSaveProject() {
    const blob = await saveProjectFile(project, mapFileData)
    downloadBlob(blob, `${project.meta.name.replace(/\s+/g, '_')}.oco`)
  }

  function handleExportIof(version: '2.0' | '3.0' = '3.0') {
    const xml = version === '2.0' ? exportIofXmlV2(project) : exportIofXml(project)
    const blob = new Blob([xml], { type: 'application/xml' })
    downloadBlob(blob, `${project.meta.name.replace(/\s+/g, '_')}_iof${version === '2.0' ? '2' : '3'}.xml`)
    setValidationOpen(false)
  }

  async function handleAddShare() {
    if (!projectId || !shareEmail.includes('@')) return
    setShareError(null)
    const sm = await getSyncMeta(projectId)
    if (!sm) { setShareError(t('header.syncFirst')); return }
    const result = await addShare(sm.cloudId, shareEmail.trim().toLowerCase(), shareRole)
    if (result.ok) {
      setShareEmail('')
      listShares(sm.cloudId).then(r => setShares(r.shares))
    } else {
      setShareError(result.error ?? t('header.failedShare'))
    }
  }

  async function handleRemoveShare(userId: string) {
    if (!projectId) return
    const sm = await getSyncMeta(projectId)
    if (!sm) return
    await removeShare(sm.cloudId, userId)
    setShares(s => s.filter(e => e.userId !== userId))
  }

  async function handleReplaceMap(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!MAP_EXTENSIONS.has(ext)) return
    const data = await file.arrayBuffer()
    const type: MapType = ext === 'ocd' ? 'ocad' : ext === 'pdf' ? 'pdf' : 'bitmap'
    replaceMapFile(file.name, type, data)
  }

  function handleSwitchTo(id: string) {
    setSwitcherOpen(false)
    guardLeave(() => switchProject(id))
  }

  return (
    <header className="flex items-center gap-2 px-3 h-12 bg-white border-b border-gray-200 z-40 shrink-0">
      {/* Left: logo + name + spec + role */}
      <button
        onClick={onGoHome}
        className="flex items-center gap-1.5 text-orange-700 hover:text-orange-900 transition-colors shrink-0"
        title={t('header.backHome')}
      >
        <Map size={18} />
        <span className="font-semibold text-sm hidden sm:inline">xcorso</span>
      </button>

      <div className="w-px h-5 bg-gray-200 shrink-0" />

      <div className="relative min-w-0" ref={switcherRef}>
        <div className="flex items-center gap-0.5 min-w-0">
          <span
            className={`text-xs font-medium truncate min-w-0 ${isViewer ? 'text-gray-600' : 'edit-icon-group cursor-pointer hover:text-orange-700 transition-colors'}`}
            onClick={isViewer ? undefined : () => eventInfoOpen ? setEventInfoOpen(false) : openEventInfo()}
            title={project.meta.name}
          >
            {project.meta.name}
          </span>
          <button
            onClick={() => setSwitcherOpen(o => !o)}
            className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors shrink-0"
            title={t('header.switchProject')}
          >
            <ChevronDown size={14} />
          </button>
        </div>

        {eventInfoOpen && !isViewer && (
          <div ref={eventInfoRef} className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-xl shadow-lg p-3 z-50 flex flex-col gap-2">
            <input
              autoFocus
              value={nameVal}
              onChange={e => setNameVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitEventInfo() }}
              placeholder={t('welcome.eventName')}
              className="text-sm font-medium border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
            <input
              type="date"
              value={eventDate}
              onChange={e => setEventDate(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
            <input
              value={organizer}
              onChange={e => setOrganizer(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitEventInfo() }}
              placeholder={t('header.organizer')}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
            <input
              value={club}
              onChange={e => setClub(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitEventInfo() }}
              placeholder={t('header.club')}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
            <input
              value={venue}
              onChange={e => setVenue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitEventInfo() }}
              placeholder={t('header.venue')}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
            <button
              onClick={commitEventInfo}
              className="text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg px-3 py-1.5 transition-colors self-end"
            >
              OK
            </button>
          </div>
        )}

        {switcherOpen && (
          <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-50">
            {otherProjects.map(p => (
              <button
                key={p.id}
                onClick={() => handleSwitchTo(p.id)}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors"
              >
                <div className="text-sm font-medium text-gray-800 truncate">{p.name}</div>
                <div className="text-[10px] text-gray-400">{new Date(p.updatedAt).toLocaleDateString()}</div>
              </button>
            ))}
            {otherProjects.length > 0 && <div className="border-t border-gray-100 my-1" />}
            <button
              onClick={() => { setSwitcherOpen(false); onGoHome() }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <Home size={14} />
              <span>{t('header.home')}</span>
            </button>
            <button
              onClick={() => { setSwitcherOpen(false); onGoHome() }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <Plus size={14} />
              <span>{t('header.newProject')}</span>
            </button>
          </div>
        )}
      </div>

      {!isViewer && (
        <select
          value={project.spec ?? 'isom-2017'}
          onChange={e => updateProjectSpec(e.target.value as EventSpec)}
          className="text-[10px] border border-gray-200 rounded px-1 py-0.5 bg-white text-gray-500 focus:outline-none focus:ring-1 focus:ring-orange-400 shrink-0 hidden sm:block"
          title={t('header.eventSpec')}
        >
          {(Object.entries(SPEC_LABEL_KEYS) as [EventSpec, string][]).map(([key, tKey]) => (
            <option key={key} value={key}>{t(tKey)}</option>
          ))}
        </select>
      )}

      {projectRole === 'viewer' && (
        <span className="flex items-center gap-1 text-[10px] font-medium text-blue-600 bg-blue-50 rounded-full px-2 py-0.5 shrink-0">
          <Eye size={10} /> {t('header.viewOnly')}
        </span>
      )}
      {projectRole === 'editor' && (
        <span className="text-[10px] font-medium text-amber-600 bg-amber-50 rounded-full px-2 py-0.5 shrink-0">{t('header.shared')}</span>
      )}
      {projectRole !== 'viewer' && (
        <div className="relative" ref={confirmUnlockRef}>
          <button
            onClick={() => locked ? setConfirmUnlock(o => !o) : toggleLocked()}
            className={`p-1 rounded transition-colors shrink-0 ${locked ? 'text-red-500 hover:text-red-700' : 'text-gray-300 hover:text-gray-500'}`}
            title={locked ? t('header.unlock') : t('header.lock')}
          >
            {locked ? <Lock size={14} /> : <LockOpen size={14} />}
          </button>
          {confirmUnlock && (
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 w-48 bg-white border border-gray-200 rounded-xl shadow-lg p-3 z-50 flex flex-col gap-2">
              <p className="text-xs font-medium text-gray-800">{t('header.confirmUnlock')}</p>
              <p className="text-[11px] text-gray-500">{t('header.confirmUnlockDesc')}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => { setConfirmUnlock(false); toggleLocked() }}
                  className="flex-1 text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg px-2 py-1.5 transition-colors"
                >
                  {t('header.confirm')}
                </button>
                <button
                  onClick={() => setConfirmUnlock(false)}
                  className="flex-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {t('header.cancel')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Right side */}
      <div className="flex items-center gap-1.5 ml-auto shrink-0">
        {/* Share (collaborators) */}
        {isOwner && cloudUser && canSync && (
          <div className="relative" ref={shareRef}>
            <button
              onClick={() => setShareOpen(o => !o)}
              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
              title={t('header.shareProject')}
            >
              <Share2 size={15} />
            </button>
            {shareOpen && (
              <div className="fixed top-12 right-2 w-80 bg-white border border-gray-200 rounded-xl shadow-lg p-3 z-50 flex flex-col gap-2" onClick={e => e.stopPropagation()}>
                <div className="flex gap-1.5">
                  <input
                    type="email"
                    value={shareEmail}
                    onChange={e => setShareEmail(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddShare() }}
                    placeholder={t('header.emailPlaceholder')}
                    className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400"
                  />
                  <select
                    value={shareRole}
                    onChange={e => setShareRole(e.target.value as 'editor' | 'viewer')}
                    className="border border-gray-200 rounded-lg px-1.5 py-1.5 text-xs bg-white focus:outline-none"
                  >
                    <option value="editor">{t('header.editor')}</option>
                    <option value="viewer">{t('header.viewer')}</option>
                  </select>
                  <button
                    onClick={handleAddShare}
                    className="p-1.5 rounded-lg bg-orange-600 text-white hover:bg-orange-700 transition-colors"
                    title={t('header.add')}
                  >
                    <UserPlus size={14} />
                  </button>
                </div>
                {shareError && <p className="text-[11px] text-red-500">{shareError}</p>}
                {shares.length > 0 && (
                  <div className="flex flex-col gap-1 mt-1">
                    {shares.map(s => (
                      <div key={s.userId} className="flex items-center justify-between text-xs px-1">
                        <span className="text-gray-700 truncate flex-1">{s.email}</span>
                        <span className="text-gray-400 text-[10px] mx-2">{s.role}{s.userId.startsWith('pending:') && ` · ${t('header.invited')}`}</span>
                        <button onClick={() => handleRemoveShare(s.userId)} className="text-gray-300 hover:text-red-400 transition-colors">
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {shares.length === 0 && <p className="text-[11px] text-gray-400 text-center py-1">{t('header.notShared')}</p>}
              </div>
            )}
          </div>
        )}

        {/* Sync + Versions (grouped) */}
        {projectRole !== 'viewer' && cloudUser && canSync && cloudUser.termsVersion !== TERMS_VERSION && (
          <button
            onClick={async () => {
              if (await acceptTerms(TERMS_VERSION)) setCloudUser({ ...cloudUser, termsVersion: TERMS_VERSION })
            }}
            className="flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-800 border border-orange-200 hover:border-orange-300 rounded-lg px-2 py-1.5 transition-colors"
            title={t('header.termsUpdated')}
          >
            <AlertTriangle size={14} />
            <span className="hidden sm:inline">{t('header.acceptTerms')}</span>
          </button>
        )}
        {projectRole !== 'viewer' && cloudUser && canSync && cloudUser.termsVersion === TERMS_VERSION && (
          <div className="flex items-center border border-gray-200 rounded-lg">
            <button
              onClick={() => syncProject()}
              disabled={syncStatus === 'syncing'}
              className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 px-2 py-1.5 transition-colors disabled:opacity-40"
              title={t('header.signedInAs', { email: cloudUser.email })}
            >
              {syncStatus === 'syncing' ? <RefreshCw size={14} className="animate-spin" /> :
               syncStatus === 'synced' ? <Cloud size={14} className="text-green-500" /> :
               syncStatus === 'error' ? <AlertTriangle size={14} className="text-red-400" /> :
               syncStatus === 'offline' ? <CloudOff size={14} className="text-gray-400" /> :
               <Cloud size={14} className="text-yellow-500" />}
            </button>
            <div className="w-px h-4 bg-gray-200" />
            <div className="relative" ref={historyRef}>
              <button
                onClick={() => setHistoryOpen(o => !o)}
                className="flex items-center text-gray-500 hover:text-gray-800 hover:bg-gray-50 px-2 py-1.5 transition-colors"
                title={t('header.versionHistory')}
              >
                <History size={14} />
              </button>
              {historyOpen && (
                <div className="absolute top-full right-0 mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-50 max-h-80 overflow-y-auto">
                  <button
                    onClick={async () => { await saveSnapshot(); }}
                    disabled={syncStatus === 'syncing'}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-orange-700 hover:bg-orange-50 transition-colors disabled:opacity-40"
                  >
                    <Save size={14} />
                    {t('header.saveSnapshot')}
                  </button>
                  <div className="border-t border-gray-100 my-1" />
                  {versionHistory.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-gray-400 text-center">{t('header.noSnapshots')}</div>
                  ) : (
                    (() => {
                      const multiEditor = new Set(versionHistory.map(e => e.editedBy).filter(Boolean)).size > 1
                      return versionHistory.map(v => (
                        <div key={v.version} className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 transition-colors">
                          <div className="flex items-center gap-2">
                            {multiEditor && v.editedBy && (
                              <span className="w-5 h-5 rounded-full text-[9px] font-bold flex items-center justify-center text-white shrink-0"
                                style={{ backgroundColor: `hsl(${(v.editedBy.charCodeAt(0) * 37 + v.editedBy.charCodeAt(1) * 53) % 360}, 55%, 50%)` }}
                              >{v.editedBy.toUpperCase()}</span>
                            )}
                            <div>
                              <div className="text-sm text-gray-700">v{v.version}</div>
                              <div className="text-[10px] text-gray-400">{new Date(v.timestamp).toLocaleString()}</div>
                            </div>
                          </div>
                          {!locked && (
                            <button
                              onClick={async () => { setHistoryOpen(false); await restoreVersionAction(v.version) }}
                              className="text-[11px] font-medium text-orange-600 hover:text-orange-800 px-2 py-1 rounded hover:bg-orange-50 transition-colors"
                            >
                              {t('header.restore')}
                            </button>
                          )}
                        </div>
                      ))
                    })()
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        {projectRole !== 'viewer' && !cloudUser && canSync && (
          <button
            onClick={onLogin}
            className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 border border-gray-200 hover:border-gray-300 rounded-lg px-2 py-1.5 transition-colors"
            title={t('header.signInSync')}
          >
            <LogIn size={14} />
            <span className="hidden sm:inline">{t('header.signIn')}</span>
          </button>
        )}
        {!canSync && (
          <span
            className={wasSynced
              ? 'flex items-center gap-1 text-xs font-medium text-amber-600 border border-amber-300 bg-amber-50 rounded-lg px-2 py-1.5'
              : 'flex items-center gap-1 text-xs text-gray-300 border border-gray-100 rounded-lg px-2 py-1.5 cursor-not-allowed'}
            title={wasSynced ? t('header.syncStale') : t('header.cloudOcadOnly')}
          >
            <CloudOff size={14} />
            {wasSynced && <span className="hidden sm:inline">{t('header.syncOff')}</span>}
          </span>
        )}

        {/* Export & validation */}
        <button
          data-tour="export-menu"
          onClick={() => setValidationOpen(true)}
          className={`flex items-center gap-1 text-xs font-medium text-white rounded-lg px-2.5 py-1.5 transition-colors ${activeIssues === 0 ? 'bg-green-600 hover:bg-green-700' : 'bg-orange-600 hover:bg-orange-700'}`}
        >
          <FileDown size={14} />
          {activeIssues > 0
            ? <AlertTriangle size={12} />
            : <Check size={12} />
          }
        </button>
        {validationOpen && (
          <ValidationDialog
            onClose={() => setValidationOpen(false)}
            onExportIof={handleExportIof}
            onSaveProject={handleSaveProject}
            onReplaceMap={() => mapInputRef.current?.click()}
          />
        )}
        <input
          ref={mapInputRef}
          type="file"
          accept=".ocd,.pdf,.jpg,.jpeg,.png,.gif,.bmp,.tif,.tiff,.webp"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleReplaceMap(f); e.target.value = '' }}
        />

        <LanguageSwitcher />

        {/* Logout — rightmost */}
        {cloudUser && (
          <button
            onClick={() => setLogoutOpen(true)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title={t('header.signOut')}
          >
            <LogOut size={14} />
          </button>
        )}
        {logoutOpen && (
          <LogoutDialog
            onClose={() => setLogoutOpen(false)}
            onLoggedOut={() => {
              setLogoutOpen(false)
              // The open project was purged with the logout — leave the editor.
              if (!useStore.getState().project) onGoHome()
            }}
          />
        )}
      </div>
    </header>
  )
}
