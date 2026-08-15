interface Props {
  onSelect: (method: 'photo' | 'text' | 'checklist') => void
  onSkip: () => void
}

export default function LogMethodSelector({ onSelect, onSkip }: Props) {
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => onSelect('photo')}
        className="block w-full rounded-lg border border-slate-200 bg-slate-100 px-4 py-4 text-left text-base font-medium text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50"
      >
        📷 Photo of my notes
      </button>
      <button
        type="button"
        onClick={() => onSelect('text')}
        className="block w-full rounded-lg border border-slate-200 bg-slate-100 px-4 py-4 text-left text-base font-medium text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50"
      >
        ✏️ Describe what we covered
      </button>
      <button
        type="button"
        onClick={() => onSelect('checklist')}
        className="block w-full rounded-lg border border-slate-200 bg-slate-100 px-4 py-4 text-left text-base font-medium text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50"
      >
        ☑️ Pick topics from a list
      </button>
      <button
        type="button"
        onClick={onSkip}
        className="flex min-h-[44px] w-full items-center justify-center text-center text-sm text-slate-500 underline dark:text-slate-400"
      >
        Skip today
      </button>
    </div>
  )
}
