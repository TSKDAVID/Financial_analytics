import { forwardRef, useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';
import { X, Loader2 } from 'lucide-react';

export const cn = clsx;

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'icon'; loading?: boolean }>(
  ({ className, variant = 'primary', size = 'md', loading, children, disabled, ...p }, ref) => (
    <button ref={ref} disabled={disabled || loading} className={cn(
      'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:pointer-events-none active:scale-[.98] whitespace-nowrap',
      size === 'sm' && 'h-8 px-3 text-xs', size === 'md' && 'h-10 px-4 text-sm', size === 'icon' && 'h-9 w-9',
      variant === 'primary' && 'bg-primary text-primary-foreground hover:opacity-90 shadow-sm shadow-primary/20',
      variant === 'secondary' && 'bg-muted text-foreground hover:bg-muted/70',
      variant === 'outline' && 'border bg-card hover:bg-muted',
      variant === 'ghost' && 'hover:bg-muted text-muted-foreground hover:text-foreground',
      variant === 'danger' && 'bg-danger text-white hover:opacity-90', className)} {...p}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}{children}
    </button>));
Button.displayName = 'Button';

export function Card({ className, children, title, action, subtitle }: { className?: string; children?: ReactNode; title?: ReactNode; action?: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className={cn('rounded-xl border bg-card text-card-foreground shadow-sm', className)}>
      {(title || action) && <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
        <div><h3 className="font-semibold tracking-tight">{title}</h3>{subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}</div>{action}</div>}
      <div className={cn(title || action ? 'px-5 pb-5 pt-2' : 'p-5')}>{children}</div>
    </div>
  );
}

const fieldCls = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring/40 focus:border-ring placeholder:text-muted-foreground disabled:opacity-60';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cn(fieldCls, className)} {...p} />);
Input.displayName = 'Input';
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cn(fieldCls, 'h-auto min-h-[70px] py-2', p.className)} />;
export const Select = ({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select className={cn(fieldCls, 'pr-8 cursor-pointer', className)} {...p}>{children}</select>;

export function Field({ label, children, hint, className }: { label: ReactNode; children: ReactNode; hint?: ReactNode; className?: string }) {
  return <label className={cn('block space-y-1.5', className)}><span className="text-xs font-medium text-muted-foreground">{label}</span>{children}{hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}</label>;
}
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="inline-flex items-center gap-3 cursor-pointer select-none text-sm">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={cn('relative h-6 w-11 rounded-full transition', checked ? 'bg-primary' : 'bg-muted border')}>
        <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>{label}
    </label>
  );
}
export function Badge({ children, tone = 'default', className }: { children: ReactNode; tone?: 'default' | 'success' | 'danger' | 'warning' | 'info' | 'primary'; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', {
    default: 'bg-muted text-muted-foreground', success: 'bg-success/15 text-success', danger: 'bg-danger/15 text-danger', warning: 'bg-warning/15 text-warning', info: 'bg-sky-500/15 text-sky-500', primary: 'bg-primary/15 text-primary',
  }[tone], className)}>{children}</span>;
}
export function Progress({ value, tone, className }: { value: number; tone?: string; className?: string }) {
  const v = Math.max(0, Math.min(1, value));
  const c = tone ?? (value >= 1 ? 'hsl(var(--danger))' : value >= 0.8 ? 'hsl(var(--warning))' : 'hsl(var(--primary))');
  return <div className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}><div className="h-full rounded-full transition-all duration-500" style={{ width: `${v * 100}%`, background: c }} /></div>;
}
export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return; const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cn('w-full max-h-[92vh] overflow-hidden flex flex-col rounded-t-2xl sm:rounded-2xl border bg-card shadow-2xl', wide ? 'sm:max-w-4xl' : 'sm:max-w-lg')}>
        <div className="flex items-center justify-between border-b px-5 py-3.5"><h2 className="font-semibold">{title}</h2><Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></Button></div>
        <div className="overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t px-5 py-3 bg-muted/30">{footer}</div>}
      </div>
    </div>
  );
}
export function Tabs<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return <div className={cn('inline-flex rounded-lg bg-muted p-1 gap-1 flex-wrap', className)}>{options.map((o) =>
    <button key={o.value} type="button" onClick={() => onChange(o.value)} className={cn('rounded-md px-3 py-1.5 text-xs font-medium transition', value === o.value ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>{o.label}</button>)}</div>;
}
export function Empty({ icon, title, children }: { icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return <div className="flex flex-col items-center justify-center text-center py-12 px-4 gap-3 text-muted-foreground">{icon && <div className="rounded-full bg-muted p-4">{icon}</div>}<p className="font-medium text-foreground">{title}</p>{children}</div>;
}
export function Stat({ label, value, delta, deltaLabel, icon, tone, invert }: { label: ReactNode; value: ReactNode; delta?: number | null; deltaLabel?: string; icon?: ReactNode; tone?: string; invert?: boolean }) {
  const good = delta == null ? null : invert ? delta <= 0 : delta >= 0;
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm relative overflow-hidden">
      <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">{label}{icon && <span className="rounded-lg p-1.5" style={{ background: (tone ?? '#6366f1') + '22', color: tone }}>{icon}</span>}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight num">{value}</div>
      {delta != null && isFinite(delta) && <div className={cn('mt-1 text-xs num', good ? 'text-success' : 'text-danger')}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta * 100).toFixed(1)}% <span className="text-muted-foreground">{deltaLabel}</span></div>}
    </div>
  );
}
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6"><div><h1 className="text-2xl font-bold tracking-tight">{title}</h1>{subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}</div>{actions && <div className="flex flex-wrap gap-2">{actions}</div>}</div>;
}
export function Spinner() { return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>; }
export const th = 'px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';
export const td = 'px-3 py-2.5';
