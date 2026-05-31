export function LoadingScreen({ message = 'Loading…' }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
      <p className="text-sm text-slate-600">{message}</p>
    </div>
  )
}
