export function SummaryStat(props: {
  label: string
  value: number
}): React.JSX.Element {
  return (
    <div className="rounded-xl border bg-muted/60 p-3 text-center">
      <strong className="block text-lg">{props.value}</strong>
      <span className="text-[11px] text-muted-foreground">{props.label}</span>
    </div>
  )
}
