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

      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        {/* Populate this section with your content */}
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
