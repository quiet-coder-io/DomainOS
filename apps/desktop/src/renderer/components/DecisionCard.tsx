interface Props {
  decisions: Array<{ decisionId: string; decision: string }>
}

export function DecisionCard({ decisions }: Props): React.JSX.Element {
  return (
    <div className="mb-3 ml-0 mr-12 animate-fade-in rounded border border-accent/30 bg-accent/5 p-3">
      {decisions.map((d, i) => (
        <div key={i} className="mt-2 first:mt-0 flex items-start gap-2 text-sm">
          <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[0.65rem] font-mono font-medium text-accent">
            {d.decisionId}
          </span>
          <span className="text-text-primary">{d.decision}</span>
        </div>
      ))}
    </div>
  )
}
