/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
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
