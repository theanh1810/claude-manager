import { useEffect, useState } from 'react'

/** True once `active` has stayed true for `delayMs`; false the moment it ends. Keeps a skeleton from flashing for fast loads. */
export function useDelayedFlag(active: boolean, delayMs = 120): boolean {
  const [elapsed, setElapsed] = useState(false)

  useEffect(() => {
    if (!active) {
      setElapsed(false)
      return
    }
    const timer = setTimeout(() => setElapsed(true), delayMs)
    return () => clearTimeout(timer)
  }, [active, delayMs])

  return active && elapsed
}
