import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { api } from '@/lib/ipc'
import type { Edit } from '@/types/edit'

// Shared React Query hook for "all edits" fetches.
//
// Why one hook, not four call-sites:
//   Before: App.tsx / StatusBar.tsx / SessionsPage.tsx / AuditPage.tsx each
//   declared their own useQuery with queryKey ['edits','all'] but different
//   queryFn (limit=1000 vs 5000) and staleTime. React Query v5 treats same
//   key => same fn; whichever mounts first wins and later mounts silently
//   piggyback on its data — so SessionsPage (5000-limit) could receive a
//   1000-cap dataset when App.tsx mounts first, and its loading state was
//   never observed => "Chưa có session nào." rendered forever on first
//   paint. Consolidating to one hook = one fn/one config, deterministic
//   result for all consumers, and consumers can opt-in to isLoading/isError.
//
// Invalidation: App.tsx already calls
//   qc.invalidateQueries({ queryKey: ['edits'] })
// on 'edits-changed'. Prefix match still works — key shape unchanged.
//
// Limit: 5000 is the higher of the two prior limits (App/StatusBar were 1000;
// Sessions/Audit were 5000). No caller shrinks that page — dropping data
// silently would break Sessions/Audit stats. 5000 covers all consumers.
export function useAllEdits(): UseQueryResult<Edit[]> {
  return useQuery({
    queryKey: ['edits', 'all'],
    queryFn: () => api.listEdits({ limit: 5000 }),
    staleTime: 5_000
  })
}
