import { clsx } from 'clsx'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

export function Button({
  variant = 'primary',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'soft' | 'danger' }) {
  const base =
    'no-drag inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none select-none active:scale-[0.98]'
  const variants = {
    primary:
      'px-4 py-2.5 text-white bg-gradient-to-b from-accent-2 to-accent shadow-lg shadow-accent/25 hover:shadow-accent/40 hover:brightness-110',
    soft: 'px-4 py-2.5 bg-white/[0.06] text-ink hover:bg-white/[0.1] border border-border',
    ghost: 'px-3 py-2 text-muted hover:text-ink hover:bg-white/[0.05]',
    danger: 'px-4 py-2.5 text-danger bg-danger/10 hover:bg-danger/20 border border-danger/30',
  }
  return (
    <button className={clsx(base, variants[variant], className)} {...props}>
      {children}
    </button>
  )
}

export function IconButton({ className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={clsx(
        'no-drag inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/10 hover:text-ink',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function Field({
  label,
  hint,
  error,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string; error?: string }) {
  return (
    <label className={clsx('block', className)}>
      {label && <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-faint">{label}</span>}
      <input
        className={clsx(
          'no-drag w-full rounded-xl bg-bg-2 px-3.5 py-2.5 text-sm text-ink placeholder:text-faint',
          'border outline-none transition-all',
          error
            ? 'border-danger/60 focus:border-danger'
            : 'border-border focus:border-accent/70 focus:ring-2 focus:ring-accent/20',
        )}
        {...props}
      />
      {error ? (
        <span className="mt-1 block text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-faint">{hint}</span>
      ) : null}
    </label>
  )
}

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={clsx('rounded-2xl border border-border bg-panel/70', className)}>{children}</div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="no-drag flex items-center gap-2.5 text-sm text-muted hover:text-ink"
    >
      <span
        className={clsx(
          'relative h-5 w-9 rounded-full transition-colors',
          checked ? 'bg-accent' : 'bg-white/10',
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
            checked ? 'left-[18px]' : 'left-0.5',
          )}
        />
      </span>
      {label}
    </button>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="no-drag inline-flex rounded-xl border border-border bg-bg-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
            value === o.value ? 'bg-accent text-white shadow' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
