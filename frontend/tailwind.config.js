/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
        typography: {
            DEFAULT: {
                css: {
                    maxWidth: 'none',
                    color: 'inherit',
                    a: {
                        color: '#60A5FA',
                        '&:hover': {
                            color: '#93C5FD',
                        },
                    },
                    code: {
                        color: 'inherit',
                    },
                    'code::before': {
                        content: '""',
                    },
                    'code::after': {
                        content: '""',
                    },
                },
            },
        },
        fontFamily: {
            'roboto-mono': ['Roboto Mono', 'monospace'],
        },
    },
},
plugins: [
        require('@tailwindcss/typography'),
    ],
} 