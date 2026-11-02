/**
 * DEXTools-style front-running mark after the quote (ETH) amount.
 * Uses Font Awesome solid `robot` path (same family DEXTools uses for bot marks).
 */
const ROBOT = {
  viewBox: "0 0 640 512",
  d: "M320 0c17.7 0 32 14.3 32 32V96H472c39.8 0 72 32.2 72 72V440c0 39.8-32.2 72-72 72H168c-39.8 0-72-32.2-72-72V168c0-39.8 32.2-72 72-72H288V32c0-17.7 14.3-32 32-32zM208 384c-8.8 0-16 7.2-16 16s7.2 16 16 16h32c8.8 0 16-7.2 16-16s-7.2-16-16-16H208zm96 0c-8.8 0-16 7.2-16 16s7.2 16 16 16h32c8.8 0 16-7.2 16-16s-7.2-16-16-16H304zm96 0c-8.8 0-16 7.2-16 16s7.2 16 16 16h32c8.8 0 16-7.2 16-16s-7.2-16-16-16H400zM264 256a40 40 0 1 0 -80 0 40 40 0 1 0 80 0zm152 40a40 40 0 1 0 0-80 40 40 0 1 0 0 80zM48 224H64V416H48c-26.5 0-48-21.5-48-48V272c0-26.5 21.5-48 48-48zm544 0c26.5 0 48 21.5 48 48v96c0 26.5-21.5 48-48 48H576V224h16z",
}

export function MevBotIcon({
  drainEth,
  className = "size-3.5",
}: {
  /** |Δ quote ETH| between the paired buy/sell legs (DEXTools “drained”). */
  drainEth?: number | null
  className?: string
}) {
  const drained =
    drainEth !== undefined && drainEth !== null && Number.isFinite(drainEth)
      ? `Drained ${drainEth.toFixed(4)} ETH — DEXTools-style front-running (same-wallet buy+sell pair).`
      : "MEV / front-running: same wallet bought and sold in the same second (or same token amount within 30s)."
  return (
    <span className="inline-flex shrink-0 text-red-500" title={drained} aria-label="MEV bot">
      <svg viewBox={ROBOT.viewBox} className={className} aria-hidden="true">
        <path fill="currentColor" d={ROBOT.d} />
      </svg>
    </span>
  )
}
