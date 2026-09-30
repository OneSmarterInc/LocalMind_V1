import {defineConfig} from '@playwright/test';
import base from './private.playwright.config';

export default defineConfig(base, {
  testMatch: 'aws-mobile.spec.ts',
});
