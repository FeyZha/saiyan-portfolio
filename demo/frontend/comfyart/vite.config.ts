import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({base:'/comfyart/',plugins:[react()],build:{outDir:process.env.SAIYAN_BUILD_OUTPUT?process.env.SAIYAN_BUILD_OUTPUT+'/comfyart':'../../workspace/original-ui/site/comfyart',emptyOutDir:false}});
