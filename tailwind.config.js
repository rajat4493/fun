/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    "./src/app/**/*.{jsx,tsx,mdx}",
    "./src/components/**/*.{jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      boxShadow: {
        glow: "0 0 80px rgba(244, 63, 94, 0.25)",
      },
      backgroundImage: {
        "fun-radial": "radial-gradient(circle at top left, rgba(244,63,94,0.32), transparent 32%), radial-gradient(circle at top right, rgba(168,85,247,0.28), transparent 30%), linear-gradient(180deg, #0a0710 0%, #110813 48%, #050506 100%)",
      },
    },
  },
  plugins: [],
};

module.exports = config;
