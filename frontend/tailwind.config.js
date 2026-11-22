/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      fontFamily: {
        ui: ['"Segoe UI Variable Text"', '"Segoe UI"', 'system-ui', 'sans-serif']
      }
    }
  }
}
