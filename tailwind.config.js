/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Paleta de colores Panorama Ingeniería
        panorama: {
          // Azul oscuro principal (rgb(2, 48, 71))
          navy: {
            DEFAULT: '#023047',
            50: '#E6F0F4',
            100: '#CCE1E9',
            200: '#99C3D3',
            300: '#66A5BD',
            400: '#3387A7',
            500: '#023047', // Principal
            600: '#022639',
            700: '#011C2B',
            800: '#01131D',
            900: '#00090F',
          },
          // Azul claro/cielo (rgb(142, 202, 230))
          sky: {
            DEFAULT: '#8ECAE6',
            50: '#F0F8FC',
            100: '#E1F1F9',
            200: '#C3E3F3',
            300: '#A5D5ED',
            400: '#87C7E7',
            500: '#8ECAE6', // Principal
            600: '#72B2D1',
            700: '#569ABC',
            800: '#3A82A7',
            900: '#1E6A92',
          },
          // Naranja principal (rgb(255, 94, 19))
          orange: {
            DEFAULT: '#FF5E13',
            50: '#FFEEE6',
            100: '#FFDDCC',
            200: '#FFBB99',
            300: '#FF9966',
            400: '#FF7733',
            500: '#FF5E13', // Principal
            600: '#CC4B0F',
            700: '#99380B',
            800: '#662507',
            900: '#331203',
          },
          // Rosa/Magenta (rgb(254, 4, 103))
          pink: {
            DEFAULT: '#FE0467',
            50: '#FFE6F2',
            100: '#FFCCE5',
            200: '#FF99CB',
            300: '#FF66B1',
            400: '#FF3397',
            500: '#FE0467', // Principal
            600: '#CB0352',
            700: '#98023E',
            800: '#650129',
            900: '#320114',
          },
          // Texto oscuro (rgb(11, 19, 32))
          dark: {
            DEFAULT: '#0B1320',
            50: '#E6E8EB',
            100: '#CCD1D7',
            200: '#99A3AF',
            300: '#667587',
            400: '#33475F',
            500: '#0B1320', // Principal
            600: '#090F1A',
            700: '#070B13',
            800: '#05080D',
            900: '#030406',
          },
        },
      },
    },
  },
  plugins: [],
}
