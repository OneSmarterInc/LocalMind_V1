import {defineConfig} from '@playwright/test';
import path from 'node:path';
const frontend=path.resolve(__dirname,'..');
export default defineConfig({
 testDir:'.',testMatch:process.env.LM_E2E_BENCH==='1'?'private-performance.spec.ts':process.env.LM_E2E_REAL_MODEL==='1'?'private-real-model.spec.ts':[ 'private-browser.spec.ts','private-parser.spec.ts' ],
 outputDir:path.join(frontend,'test-results/runs'),
 timeout:120000,expect:{timeout:25000},workers:1,fullyParallel:false,
 reporter:[['line'],['json',{outputFile:path.join(frontend,'test-results/private-browser-results.json')}]],
 use:{...(process.env.LM_BROWSER_EXECUTABLE?{launchOptions:{executablePath:process.env.LM_BROWSER_EXECUTABLE}}:{}),...(process.env.LM_BROWSER_PROXY?{proxy:{server:process.env.LM_BROWSER_PROXY,bypass:'127.0.0.1,localhost'}}:{}),baseURL:'http://127.0.0.1:8765',viewport:{width:1365,height:900},screenshot:'only-on-failure',trace:'retain-on-failure'},
 webServer:{command:'python ../tests/start_private_browser_server.py',cwd:frontend,url:'http://127.0.0.1:8765/api/health/',timeout:120000,reuseExistingServer:false,env:{RUN_LOCALMIND_BROWSER_TESTS:'1'}},
});
