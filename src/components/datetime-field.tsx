"use client"

import { useMemo, useState } from "react"
import { Popover } from "@base-ui/react/popover"
import { CalendarClock, ChevronDown } from "lucide-react"
import {
  clampParts,
  daysInMonth,
  formatParts,
  type DateTimeParts,
} from "@/lib/timezone"

const MONTHS = [
  { value: 1, label: "Jan" },
  { value: 2, label: "Feb" },
  { value: 3, label: "Mar" },
  { value: 4, label: "Apr" },
  { value: 5, label: "May" },
  { value: 6, label: "Jun" },
  { value: 7, label: "Jul" },
  { value: 8, label: "Aug" },
  { value: 9, label: "Sep" },
  { value: 10, label: "Oct" },
  { value: 11, label: "Nov" },
  { value: 12, label: "Dec" },
]

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = Array.from({ length: 60 }, (_, i) => i)
const SECONDS = MINUTES

type DateTimeFieldProps = {
  label: string
  value: DateTimeParts | null
  onChange: (value: DateTimeParts) => void
  fallback?: DateTimeParts | null
  yearMin?: number
  yearMax?: number
}

export function DateTimeField({
  label,
  value,
  onChange,
  fallback = null,
  yearMin = 2018,
  yearMax = new Date().getUTCFullYear() + 1,
}: DateTimeFieldProps) {
  const [open, setOpen] = useState(false)
  const draft = useMemo(
    () => clampParts(value ?? fallback ?? defaultParts()),
    [value, fallback],
  )
  const years = useMemo(() => {
    const min = Math.min(yearMin, draft.year)
    const max = Math.max(yearMax, draft.year)
    return Array.from({ length: max - min + 1 }, (_, i) => min + i)
  }, [yearMin, yearMax, draft.year])
  const days = useMemo(
    () => Array.from({ length: daysInMonth(draft.year, draft.month) }, (_, i) => i + 1),
    [draft.year, draft.month],
  )

  function patch(partial: Partial<DateTimeParts>) {
    onChange(clampParts({ ...draft, ...partial }))
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        type="button"
        className="inline-flex h-10 min-w-[11.5rem] items-center gap-2 rounded-lg border border-input bg-background px-3 text-left text-sm text-foreground hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={label}
      >
        <CalendarClock className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</span>
          <span className={`truncate font-mono text-xs ${value ? "text-foreground" : "text-muted-foreground"}`}>
            {value ? formatParts(value) : "Select…"}
          </span>
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end" className="z-50">
          <Popover.Popup className="w-[22rem] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg outline-none">
            <Popover.Title className="mb-3 text-sm font-medium">{label}</Popover.Title>
            <div className="grid grid-cols-3 gap-2">
              <FieldSelect
                label="Year"
                value={draft.year}
                options={years.map((year) => ({ value: year, label: String(year) }))}
                onChange={(year) => patch({ year })}
              />
              <FieldSelect
                label="Month"
                value={draft.month}
                options={MONTHS}
                onChange={(month) => patch({ month })}
              />
              <FieldSelect
                label="Day"
                value={draft.day}
                options={days.map((day) => ({ value: day, label: String(day) }))}
                onChange={(day) => patch({ day })}
              />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <FieldSelect
                label="Hour"
                value={draft.hour}
                options={HOURS.map((hour) => ({ value: hour, label: pad2(hour) }))}
                onChange={(hour) => patch({ hour })}
              />
              <FieldSelect
                label="Min"
                value={draft.minute}
                options={MINUTES.map((minute) => ({ value: minute, label: pad2(minute) }))}
                onChange={(minute) => patch({ minute })}
              />
              <FieldSelect
                label="Sec"
                value={draft.second}
                options={SECONDS.map((second) => ({ value: second, label: pad2(second) }))}
                onChange={(second) => patch({ second })}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <QuickButton
                label="00:00:00"
                onClick={() => patch({ hour: 0, minute: 0, second: 0 })}
              />
              <QuickButton
                label="23:59:59"
                onClick={() => patch({ hour: 23, minute: 59, second: 59 })}
              />
              {fallback ? (
                <QuickButton
                  label="From tape"
                  onClick={() => onChange(clampParts(fallback))}
                />
              ) : null}
            </div>
            <div className="mt-3 flex justify-end">
              <Popover.Close
                className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
                onClick={() => onChange(clampParts(draft))}
              >
                Done
              </Popover.Close>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

function FieldSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: number
  options: { value: number; label: string }[]
  onChange: (value: number) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-[10px] tracking-wide text-muted-foreground uppercase">
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-9 rounded-lg border border-input bg-background px-2 font-mono text-sm text-foreground"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function QuickButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="rounded-full bg-muted px-2.5 py-1 text-xs text-foreground hover:bg-accent"
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function defaultParts(): DateTimeParts {
  const now = new Date()
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hour: now.getHours(),
    minute: now.getMinutes(),
    second: now.getSeconds(),
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}
