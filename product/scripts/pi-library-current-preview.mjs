import path from 'node:path';
import { PiCompetitionRuntime } from '../platform/pi-agent/runtime.ts';
import { createCompetitionIngestion } from '../platform/web/competition-ingestion.ts';
import { readCompetitionLibrary } from '../platform/pi-agent/competition-library.ts';
import { workbenchPlugin } from '../platform/web/workbench-plugin.ts';
import { createServer } from '../platform/web/node_modules/vite/dist/node/index.js';
import react from '../platform/web/node_modules/@vitejs/plugin-react/dist/index.js';

if(process.argv.length>2)throw new Error('当前入口直接读取正式库，不接受旧评测目录或历史回答参数。');
const root=process.cwd(),port=3187;
const library=await readCompetitionLibrary(root);
const runtime=new PiCompetitionRuntime(root);
const server=await createServer({configFile:false,envFile:false,envDir:false,root:path.join(root,'platform/web'),
    cacheDir:path.join(root,'workspace/competition-maintenance/current-contract-20261025/vite-cache'),
    plugins:[react(),workbenchPlugin({root,runtime,ingestion:createCompetitionIngestion(root),handlerDependencies:{
        allowedAuthorities:[`127.0.0.1:${port}`,`localhost:${port}`],
        readBootstrap:async()=>({projects:[],assets:[],files:[],competitionEngine:'pi',cachedCompetitionBriefs:[],agent:{url:'',token:''}})
    }})],resolve:{alias:{'@':path.join(root,'platform/web/src')}},
    define:{__APP_VERSION__:JSON.stringify('竞赛统一版'),__APP_RELEASES__:'[]'},
    server:{host:'127.0.0.1',port,strictPort:true,hmr:false,watch:{ignored:['**/workspace/**']}},clearScreen:false,logLevel:'warn'});
await server.listen();
console.log(JSON.stringify({page:`http://127.0.0.1:${port}/competitions`,items:library.items.length,pending:library.pending.length,
    dataContract:2,directFormalLibrary:true,historyCopied:false,autoSubmit:false}));
process.on('SIGINT',async()=>{await server.close();process.exit();});
