/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        xp: {
          wallpaper: '#3A6EA5',
          taskbar: '#1F3A6E',
          'taskbar-light': '#2A5DB0',
          'title-blue': '#0A246A',
          'title-mid': '#3A6EA5',
          'title-light': '#4A8BC2',
          'window-bg': '#ECE9D8',
          'button-face': '#ECE9D8',
          'button-shadow': '#808080',
          'button-highlight': '#FFFFFF',
          selection: '#316AC5',
          'start-green': '#3C8D2F',
          'start-green-light': '#4DA53E',
          navy: '#003399',
          bsod: '#000080',
        },
      },
      fontFamily: {
        xp: ['"Trebuchet MS"', 'Tahoma', 'sans-serif'],
        'xp-body': ['Tahoma', '"Trebuchet MS"', 'sans-serif'],
      },
      boxShadow: {
        'xp-raised': 'inset 1px 1px 0 #fff, inset -1px -1px 0 #808080, inset 2px 2px 0 #dfdfdf, inset -2px -2px 0 #404040',
        'xp-sunken': 'inset 1px 1px 0 #808080, inset -1px -1px 0 #fff, inset 2px 2px 0 #404040, inset -2px -2px 0 #dfdfdf',
        'xp-window': '2px 2px 10px rgba(0,0,0,0.3), inset 0 0 0 1px #0A246A',
      },
    },
  },
  daisyui: {
    themes: ['lofi'],
    logs: false,
  },
  plugins: [require('daisyui')],
}
