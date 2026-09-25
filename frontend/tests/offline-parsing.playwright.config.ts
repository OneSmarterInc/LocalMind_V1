import {defineConfig} from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
/** Runs the app from a LAN address over plain http, the way a campus server or the
 * shared launcher is usually reached. Browsers do not give that origin a service
 * worker, so this is the case where book import used to fail without a connection. */
const lan=process.env.LM_LAN_HOST||Object.values(os.networkInterfaces()).flat().find(i=>i&&i.family==='IPv4'&&!i.internal)?.address;
if(!lan)throw new Error('No LAN IPv4 address found; set LM_LAN_HOST.');
const frontend=path.resolve(__dirname,'..');
export default defineConfig({
 testDir:'.',testMatch:'offline-parsing.spec.ts',outputDir:path.join(frontend,'test-results/offline-parsing'),
 timeout:120000,expect:{timeout:25000},workers:1,fullyParallel:false,reporter:[['line']],
 use:{...(process.env.LM_BROWSER_EXECUTABLE?{launchOptions:{executablePath:process.env.LM_BROWSER_EXECUTABLE}}:{}),baseURL:`http://${lan}:8766`,viewport:{width:1365,height:900},screenshot:'only-on-failure'},
 webServer:{command:'python ../tests/start_private_browser_server.py',cwd:frontend,url:`http://${lan}:8766/api/health/`,timeout:120000,reuseExistingServer:false,
  env:{RUN_LOCALMIND_BROWSER_TESTS:'1',LM_BROWSER_BIND:`0.0.0.0:8766`,LM_BROWSER_ALLOWED_HOSTS:`${lan},127.0.0.1,localhost`}},
});
