/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Bricolage Grotesque"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        flow: { '0%': { strokeDashoffset: '0' }, '100%': { strokeDashoffset: '-48' } },
      },
      animation: { flow: 'flow 1.6s linear infinite' },
    },
  },
  plugins: [],
};
