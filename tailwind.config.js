import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Absolute paths, not relative globs — postcss.config.js now imports this
// config as a JS object rather than a file path (see that file's header
// for why), and a relative glob has no reliable base directory to resolve
// against once that happens. import.meta.url is deterministic regardless
// of process.cwd(), unlike a relative content glob was.
const dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('tailwindcss').Config} */
export default {
  content: [path.join(dirname, 'index.html'), path.join(dirname, 'src/**/*.{js,jsx,ts,tsx}')],
  darkMode: 'media',
  theme: {
    extend: {}
  },
  plugins: []
}
