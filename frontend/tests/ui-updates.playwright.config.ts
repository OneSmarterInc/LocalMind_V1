import base from './private.playwright.config';
import {defineConfig} from '@playwright/test';
export default defineConfig({...base,testMatch:'ui-updates.spec.ts',timeout:60000,reporter:'line'});
