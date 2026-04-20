import { chromium, BrowserContext } from 'playwright';
import { homedir } from 'os';
import { join } from 'path';

const BROWSER_DATA = join(homedir(), '.beliin', 'browser-data');

class BrowserManager {
  private context: BrowserContext | null = null;

  async init(): Promise<void> {
    this.context = await chromium.launchPersistentContext(BROWSER_DATA, {
      headless: false,
      channel: 'chrome',
      viewport: { width: 1280, height: 720 },
      locale: 'id-ID',
    });
    console.error('[beliin] Browser context launched');
  }

  async newPage() {
    if (!this.context) throw new Error('Browser not initialized');
    return this.context.newPage();
  }

  async cleanup(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
      console.error('[beliin] Browser context closed');
    }
  }
}

export const browser = new BrowserManager();
