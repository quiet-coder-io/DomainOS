export function BrainIcon(props: React.SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M8 2C6.5 2 5.2 2.8 4.6 4 3.1 4.2 2 5.5 2 7c0 1.3.8 2.4 2 2.8V13a1 1 0 001 1h2V8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M8 2c1.5 0 2.8.8 3.4 2 1.5.2 2.6 1.5 2.6 3 0 1.3-.8 2.4-2 2.8V13a1 1 0 01-1 1H9V8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}
