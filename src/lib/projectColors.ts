/** The dot colours a newly added project can get. */
export const PROJECT_COLORS = [
  '#6366f1', // indigo
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#8b5cf6', // violet
  '#ef4444', // rose
  '#22c55e' // green
] as const

export function pickProjectColor(random: () => number = Math.random): string {
  return PROJECT_COLORS[Math.floor(random() * PROJECT_COLORS.length)]
}
