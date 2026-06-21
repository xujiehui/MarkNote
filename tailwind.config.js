/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#EFF6FF',
          100: '#DBEAFE',
          200: '#BFDBFE',
          300: '#93C5FD',
          400: '#60A5FA',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
        },
        success: '#22C55E',
        warning: '#F59E0B',
        error: '#EF4444',
        info: '#3B82F6',
        ink: '#24221f',
        paper: '#fbfaf7',
        linen: '#f4efe7',
        moss: '#4f6f52',
        clay: '#b45f45',
        graphite: '#2c313a',
      },
      boxShadow: {
        subtle: '0 1px 2px rgba(36, 34, 31, 0.08), 0 8px 30px rgba(36, 34, 31, 0.06)',
      },
    },
  },
  plugins: [],
};
