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
      className={`grid h-8 w-[35px] place-items-center rounded-lg text-sm transition ${
        active
          ? 'bg-[#eaf2ff] text-[#2f7df6]'
          : 'text-[#111827] hover:bg-[#f3f4f6]'
      } ${className}`}
      {...props}
    >
      <Icon size={16} strokeWidth={2} />
    </button>
  );
}
