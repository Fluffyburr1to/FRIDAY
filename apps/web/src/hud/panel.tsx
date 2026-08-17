/**
 * The frame every panel sits in.
 *
 * One frame rather than three, so a panel cannot quietly acquire its own
 * chrome, heading weight, or idea of how much room it deserves. On a surface
 * the owner keeps open all day, that drift turns an instrument panel into a
 * collection of widgets.
 */
export function Panel(input: {
  title: string
  children: React.ReactNode

  /** Rendered at the right of the heading — a measurement time, or a warning. */
  note?: string
}): React.JSX.Element {
  const { title, children, note } = input

  return (
    <section className="panel" aria-label={title}>
      <header className="panel__head">
        <h2 className="panel__title">{title}</h2>
        {note !== undefined && <span className="panel__note">{note}</span>}
      </header>
      <div className="panel__body">{children}</div>
    </section>
  )
}
