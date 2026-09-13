import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'.',testMatch:process.env.LM_E2E_REAL_MODEL==='1'?'private-real-model.spec.ts':'private-browser.spec.ts',
 timeout:120000,expect:{timeout:25000},workers:1,fullyParallel:false,
 reporter:[['line'],['json',{outputFile:'test-results/private-browser-results.json'}]],
 use:{baseURL:'http://127.0.0.1:8765',viewport:{width:1365,height:900},screenshot:'only-on-failure',trace:'retain-on-failure'},
 webServer:{command:'python ../tests/start_private_browser_server.py',url:'http://127.0.0.1:8765/api/health/',timeout:120000,reuseExistingServer:false,env:{RUN_LOCALMIND_BROWSER_TESTS:'1'}},
});
