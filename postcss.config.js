// Import the Tailwind config directly rather than letting the tailwindcss
// plugin discover it by path: when this dev server is spawned with a
// working directory other than this project root (confirmed live — see
// the Phase 7 debugging notes), Tailwind's own cwd-based config search
// silently finds nothing and falls back to an empty `content`, dropping
// every utility class from the build. A relative `import` specifier is
// always resolved against this file's own location, never process.cwd(),
// so it can't be affected by that.
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import tailwindConfig from './tailwind.config.js'

export default {
  plugins: [tailwindcss(tailwindConfig), autoprefixer]
}
