import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseChangelog } from './src/lib/release';

export default defineConfig({
  plugins:[react()],
  resolve:{alias:{'@':resolve(import.meta.dirname,'src')}},
  define:{
    __APP_VERSION__:JSON.stringify(readFileSync(resolve(import.meta.dirname,'../VERSION'),'utf8').trim()),
    __APP_RELEASES__:JSON.stringify(parseChangelog(readFileSync(resolve(import.meta.dirname,'../CHANGELOG.md'),'utf8'))),
  },
  build:{outDir:process.env.SAIYAN_BUILD_OUTPUT||'../../workspace/original-ui/site',emptyOutDir:false},
});
