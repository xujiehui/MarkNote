import type { ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ComponentType<LucideProps>;
  label: string;
  active?: boolean;
}

export function IconButton({ icon: Icon, label, active, className = '', ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`grid h-8 w-8 place-items-center rounded-md border text-sm transition ${
        active
          ? 'border-moss bg-moss text-white'
          : 'border-stone-300 bg-white text-stone-700 hover:border-stone-400 hover:bg-stone-100'
      } ${className}`}
      {...props}
    >
      <Icon size={16} strokeWidth={2} />
    </button>
  );
}
