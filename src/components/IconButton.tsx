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
          ? 'border-primary-600 bg-primary-600 text-white'
          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900'
      } ${className}`}
      {...props}
    >
      <Icon size={16} strokeWidth={2} />
    </button>
  );
}
