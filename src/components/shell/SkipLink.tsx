/** The first focusable element: hidden until focused, then moves focus to main. */
export default function SkipLink() {
  return (
    <a
      href="#main"
      onClick={(e) => {
        e.preventDefault()
        document.getElementById('main')?.focus()
      }}
      className="sr-only rounded-md border border-transparent bg-accent px-2 text-sm font-medium leading-7 text-accent-on focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-sticky"
    >
      Bỏ qua tới nội dung chính
    </a>
  )
}
