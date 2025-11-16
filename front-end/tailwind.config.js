/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../../admin/src/**/*.{js,ts,jsx,tsx}',
  ],
  // Force Tailwind utilities to apply with `!important` for precedence over global styles
  important: true,
  theme: {
    extend: {
      colors: {
        'gb-green': '#4CAF50',
        'gb-green-dark': '#388E3C',
        'gb-orange': '#FF5722',
        'gb-pink': 'rgb(236, 72, 153)',
        primary: '#4CAF50',
        secondary: '#FF5722'
      }
    },
  },
  plugins: [],
};