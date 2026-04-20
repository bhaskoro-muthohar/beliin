import { chromium, BrowserContext } from 'playwright';
import { homedir } from 'os';
import { join } from 'path';

const BROWSER_DATA = process.env.BELIIN_BROWSER_DATA
  || join(homedir(), '.beliin', 'browser-data');

class BrowserManager {
  private context: BrowserContext | null = null;
  private launching: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.context) return;
    if (this.launching) return this.launching;
    this.launching = this.doInit();
    return this.launching;
  }

  private async doInit(): Promise<void> {
    this.context = await chromium.launchPersistentContext(BROWSER_DATA, {
      headless: false,
      viewport: { width: 1280, height: 720 },
      locale: 'id-ID',
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
      ],
    });
    console.error('[beliin] Browser context launched');
  }

  async newPage() {
    await this.init();
    return this.context!.newPage();
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
