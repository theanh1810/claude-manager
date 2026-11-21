import { useLayoutEffect, useRef, useState } from 'react'

export interface ElementSize {
  width: number
  height: number
}

/** Measures an element before paint and again whenever it resizes. No dependency: VirtualList needs a pixel height. */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const { width, height } = el.getBoundingClientRect()
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return // jsdom: tests give the element a fixed box instead
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return [ref, size] as const
}
