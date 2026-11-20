import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { RestartToApply } from '@/components/roster/restart-to-apply'
import { skillLibrary } from '@/lib/api/skill-library'

export function useCatalog(target: string) {
  return useQuery({
    queryKey: ['agent-skills', target],
    queryFn: () => skillLibrary.list(target),
    refetchInterval: query => query.state.data?.pending ? 5000 : false,
  })
}

export function BotSkills({ name }: { name: string }) {
  const query = useCatalog(name)
  const granted = Object.keys(query.data?.effective ?? {}).sort()
  return <section className="space-y-2">
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">Agent skills</h3>
      <Link className="text-sm text-primary underline" to={'/store?tab=skills&target=' + encodeURIComponent(name)}>Manage skills</Link>
    </div>
    <p className="text-xs text-muted-foreground">{query.isError ? 'Skills unavailable.' : query.isPending ? 'Loading skills…' : granted.join(', ') || 'No managed skills assigned.'}</p>
    {query.data?.pending && <RestartToApply name={name} />}
  </section>
}
