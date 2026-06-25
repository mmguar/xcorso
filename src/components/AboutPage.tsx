import { Map } from 'lucide-react'

interface Props { onBack: () => void }

export function AboutPage({ onBack }: Props) {
  return (
    <div className="flex flex-col items-center justify-center h-full bg-gray-50 p-8 gap-8">
      <div className="flex flex-col items-center gap-3">
        <div className="w-16 h-16 bg-orange-600 rounded-2xl flex items-center justify-center shadow-lg">
          <Map size={32} className="text-white" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">xcorso</h1>
      </div>

      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-200 p-6 flex flex-col gap-3">
        <div className="flex gap-4 text-sm">
          <a href="/terms.html" target="_blank" rel="noopener" className="text-orange-600 underline hover:text-orange-800">Terms of Service</a>
          <a href="/privacy.html" target="_blank" rel="noopener" className="text-orange-600 underline hover:text-orange-800">Privacy Policy</a>
        </div>
      </div>

      <button
        onClick={onBack}
        className="text-sm text-gray-500 hover:text-orange-600 transition-colors"
      >
        Back to home
      </button>
    </div>
  )
}
