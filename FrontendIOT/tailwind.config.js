/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class', // ✅ REQUIRED
  content: [
    './src/**/*.{html,ts}'
  ],
  theme: {
    extend: {
      colors: {
        'bg-light-gray': 'var(--color-bg-light-gray)',
      },
      fontFamily: {
        ubuntu: ['Ubuntu', 'sans-serif'],
        franklin: ['Libre Franklin', 'sans-serif'],
      },
      keyframes: {
    blink: {
      '0%, 100%': { borderColor: 'transparent' },
      '50%': { borderColor: '#fb3748' }, // red
    },
    borderMove: {
      '0%': { backgroundPosition: '0% 50%' },
      '100%': { backgroundPosition: '100% 50%' },
    },
  },
  animation: {
    blink: 'blink 1s infinite',
    borderMove: 'borderMove 3s linear infinite',
  }
    },
  },
  plugins: [],
}
