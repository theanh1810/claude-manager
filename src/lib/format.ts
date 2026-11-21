/** The text of a rejected Tauri call: Rust returns a plain string, other errors are Error objects. */
export function errorText(e: unknown): string {
  return typeof e === 'string' ? e : e instanceof Error ? e.message : String(e)
}

export function shortPath(p: string) {
  const parts = p.split('/')
  return parts.slice(-2).join('/')
}
