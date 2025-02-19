import chalk from 'chalk';
import consoleStamp from 'console-stamp';
import ora from 'ora';
import { v4 as uuidV4 } from 'uuid';
import WebSocket from 'ws';
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import fs from 'fs';
import readline from 'readline';

let CoderMarkPrinted = false;

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l)'
});
process.setMaxListeners(0);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const getUnixTimestamp = () => Math.floor(Date.now() / 1000);
const PING_INTERVAL = 15 * 1000;
const MAX_CONNECTIONS = 50;
const MIN_DELAY = 100;
const MAX_DELAY = 3000;
const WEBSOCKET_URLS = [
  'wss://proxy2.wynd.network:4444',
  'wss://proxy2.wynd.network:4650',
];

const randomUserAgent = () => {
  const userAgents = [
    // Chrome
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    // Firefox
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0",
    // Safari
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    // Edge
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
    // Opera
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/91.0.4516.20",
    // Mobile
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
    // Additional variations
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Vivaldi/6.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 EdgA/130.0.0.0",
  ];

  return userAgents[Math.floor(Math.random() * userAgents.length)];
};

const sleep = (ms) => {
  console.log('[SLEEP] sleeping for', ms, '...');
  return new Promise((resolve) => setTimeout(resolve, ms));
};

function getRandomInt(min, max) {
  const minCeiled = Math.ceil(min);
  const maxFloored = Math.floor(max);
  return Math.floor(Math.random() * (maxFloored - minCeiled) + minCeiled);
}

class App {
  constructor(user, proxy, version = '4.29.0') {
    this.proxy = proxy;
    this.userId = user.id;
    this.version = version;
    this.browserId = null;
    this.websocket = null;
    this.userAgent = user.userAgent || randomUserAgent();
  }

  async start() {
    this.browserId ??= uuidV4();

    if (this.proxy) {
      console.info(`request with proxy: ${chalk.blue(this.proxy)}...`);
    }

    console.info(`Getting IP address...`, this.proxy);
    try {
      const ipAddress = await this.getIpAddress(this.proxy);
      console.info(`IP address: ${chalk.blue(ipAddress)}`);

      if (this.proxy && !ipAddress.includes(new URL(this.proxy).hostname)) {
        console.error(`[ERROR] Proxy IP address does not match! maybe the proxy is not working...`);
      }
    } catch (e) {
      console.error(`[ERROR] Could not get IP address! ${chalk.red(e)}`);
      return;
    }

    const websocketUrl = WEBSOCKET_URLS[getRandomInt(0, WEBSOCKET_URLS.length - 1)];

    const isWindows = this.userAgent.includes('Windows') || this.userAgent.includes('Win64') || this.userAgent.includes('Win32');

    let options = {
      headers: {
        "Pragma": "no-cache",
        "User-Actor": this.userAgent,
        OS: isWindows ? 'Windows' : 'Mac',
        Browser: 'Chrome',
        Platform: 'Desktop',
        "Sec-WebSocket-Version": "13",
        'Accept-Language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7',
        "Cache-Control": "no-cache",
        "priority": "u=1, i",
      },
      handshakeTimeout: 30000,
      rejectUnauthorized: false,
    };

    if (this.proxy) {
      console.log(`configuring websocket proxy agent...(${this.proxy})`);
      options.agent = await this.getProxyAgent(this.proxy);
      console.log('websocket proxy agent configured.');
    }

    this.websocket = new WebSocket(websocketUrl, options);

    this.websocket.on('open', async function (e) {
      console.log("[wss] Websocket connected!");
      this.sendPing();
    }.bind(this));

    this.websocket.on('message', async function (data) {
      console.log(`[wss] received message: ${chalk.blue(data)}`);

      let parsedMessage;
      try {
        parsedMessage = JSON.parse(data);
      } catch (e) {
        console.error(`[wss] Could not parse WebSocket message! ${chalk.red(data)}`);
        console.error(`[wss] ${chalk.red(e)}`);
        return;
      }

      switch (parsedMessage.action) {
        case 'AUTH':
          const message = JSON.stringify({
            id: parsedMessage.id,
            origin_action: parsedMessage.action,
            result: {
              browser_id: this.browserId,
              user_id: this.userId,
              user_agent: this.userAgent,
              timestamp: getUnixTimestamp(),
              device_type: "desktop",
              version: this.version,
            }
          });
          this.sendMessage(message);
          console.log(`[wss] (AUTH) message sent: ${chalk.green(message)}`);
          break;
        case 'PONG':
          console.log(`[wss] received pong: ${chalk.green(data)}`);
          break;
        default:
          console.error(`[wss] No RPC action ${chalk.red(parsedMessage.action)}!`);
          break;
      }
    }.bind(this));

    this.websocket.on('close', async function (code) {
      console.log(`[wss] Connection died: ${chalk.red(code)}`);
      setTimeout(() => {
        this.start();
      }, PING_INTERVAL);
    }.bind(this));

    this.websocket.on('error', function (error) {
      console.error(`[wss] ${error}`);
      this.websocket.terminate();

      setTimeout(() => {
        this.start();
      }, PING_INTERVAL);
    }.bind(this));
  }

  async sendPing() {
    setInterval(() => {
      const message = JSON.stringify({
        id: uuidV4(),
        version: '1.0.0',
        action: 'PING',
        data: {},
      });
      this.sendMessage(message);
      console.log(`[wss] send ping: ${chalk.green(message)}`);
    }, PING_INTERVAL);
  }

  async sendMessage(message) {
    if (this.websocket.readyState !== WebSocket.OPEN) {
      console.error(`[wss] WebSocket is not open!`);
      return;
    }

    this.websocket.send(message);
    console.log(`[wss] message sent: ${chalk.green(message)}`);
  }

  async getIpAddress(proxy) {
    let options = {};
    console.log(`[GET IP] Getting IP address...${proxy ? ` with proxy ${proxy}` : ''}`);

    if (proxy) {
      const agent = await this.getProxyAgent(proxy);
      console.log(`[GET IP] Using proxy agent...`);
      options.httpAgent = agent;
      options.httpsAgent = agent;
    }

    return await axios.get('https://ipinfo.io/json', options)
      .then(response => response.data.ip);
  }

  async getProxyAgent(proxy) {
    if (proxy.startsWith('http://') || proxy.startsWith('https://')) {
      return new HttpsProxyAgent(proxy);
    } else if (proxy.startsWith('socks://') || proxy.startsWith('socks5://')) {
      return new SocksProxyAgent(proxy);
    }

    throw new Error(`Unsupported proxy ${proxy}`);
  }
}

async function run(user, proxy) {
  const isProxyWorking = await checkProxy(proxy);
  if (!isProxyWorking) {
    console.log(chalk.red(`Proxy ${proxy} failed, skipping...`));
    return;
  }

  const app = new App(user, proxy);

  const spinner = ora({ text: 'Loading…' }).start();
  let prefixText = `[user:${chalk.green(user.id.substring(-12))}]`;

  if (proxy) {
    const [ip, port] = new URL(proxy).host.split(':');
    prefixText += `[proxy:${chalk.green(ip)}:${chalk.green(port)}]`;
  }

  spinner.prefixText = prefixText;
  spinner.succeed(`Started!`);

  try {
    await app.start();
  } catch (e) {
    console.error(e);
    await app.start();
  }

  process.on('SIGINT', function () {
    console.log('Caught interrupt signal');
    spinner.stop();
    process.exit();
  });
}

const USER_ID = fs.readFileSync('uid.txt', 'utf-8').trim();

if (!USER_ID) {
  console.error('USER_ID not found in uid.txt');
  process.exit(1);
}

const USER = {
  id: USER_ID,
  userAgent: randomUserAgent()
};

async function validateProxy(proxy) {
  try {
    const agent = new HttpsProxyAgent(proxy);
    const response = await axios.get('https://ipinfo.io/json', {
      httpAgent: agent,
      httpsAgent: agent,
      timeout: 5000
    });
    return response.status === 200;
  } catch (error) {
    return false;
  }
}

async function fetchLatestUserAgents() {
  const maxRetries = 3;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      const response = await axios.get('https://gist.githubusercontent.com/pzb/b4b6f57144aea7827ae4/raw/5626efb6a2b973d1a3e8dca9a5d1a7df8103f1c8/useragents.txt', {
        timeout: 5000
      });
      
      if (response.status === 200 && response.data) {
        const agents = response.data.split('\n')
          .map(ua => ua.trim())
          .filter(ua => ua.length > 0);
        return agents.slice(0, 50);
      }
    } catch (error) {
      console.error(chalk.yellow(`Attempt ${retryCount + 1} failed to fetch user agents:`), error.message);
      retryCount++;
      if (retryCount < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }
  
  try {
    const cachedAgents = fs.readFileSync('useragents.txt', 'utf-8').split('\n')
      .map(ua => ua.trim())
      .filter(ua => ua.length > 0);
    console.log(chalk.yellow('Using cached user agents as online fetch failed'));
    return cachedAgents.slice(0, 50);
  } catch (error) {
    console.error(chalk.red('Failed to use cached user agents:'), error);
    return [];
  }
}

async function updateProxies() {
  try {
    const response = await axios.get('https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt');
    let proxies = response.data.split('\n')
      .map(proxy => proxy.trim())
      .filter(proxy => proxy)
      .map(proxy => proxy.startsWith('http://') ? proxy : `http://${proxy}`);
    
    fs.writeFileSync('proxy.txt', proxies.join('\n'));
    console.log(chalk.green(`Proxies updated successfully! ${proxies.length} working proxies found.`));
    return proxies;
  } catch (error) {
    console.error(chalk.red('Failed to update proxies:'), error);
    return [];
  }
}

let PROXIES = fs.readFileSync('proxy.txt').toString().split('\n').map(proxy => proxy.trim()).filter(proxy => proxy);
let workingProxies = [];
let failedProxies = [];

let proxyStats = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  lastUpdated: new Date().toISOString()
};

function updateProxyStats(success) {
  proxyStats.totalRequests++;
  if (success) {
    proxyStats.successfulRequests++;
  } else {
    proxyStats.failedRequests++;
  }
  proxyStats.lastUpdated = new Date().toISOString();
}

async function checkProxy(proxy) {
  try {
    const agent = new HttpsProxyAgent(proxy);
    const startTime = Date.now();
    await axios.get('https://ipinfo.io/json', {
      httpAgent: agent,
      httpsAgent: agent,
      timeout: 5000
    });
    const responseTime = Date.now() - startTime;
    
    workingProxies.push({
      proxy,
      responseTime,
      lastSuccess: new Date().toISOString()
    });
    updateProxyStats(true);
    return true;
  } catch (error) {
    failedProxies.push({
      proxy,
      error: error.message,
      lastFailure: new Date().toISOString()
    });
    updateProxyStats(false);
    return false;
  }
}

async function updateProxyList() {
  PROXIES = PROXIES.filter(proxy => !failedProxies.some(failed => failed.proxy === proxy));
  
  workingProxies.sort((a, b) => a.responseTime - b.responseTime);
  
  if (workingProxies.length < 50) {
    const newProxies = await updateProxies();
    PROXIES = [...new Set([...workingProxies.map(wp => wp.proxy), ...newProxies])];
  }
  
  fs.writeFileSync('proxy.txt', PROXIES.join('\n'));
  fs.writeFileSync('proxy_stats.json', JSON.stringify(proxyStats, null, 2));
  
  console.log(chalk.blue('Proxy statistics:'));
  console.log(`Total requests: ${proxyStats.totalRequests}`);
  console.log(`Successful: ${proxyStats.successfulRequests}`);
  console.log(`Failed: ${proxyStats.failedRequests}`);
  console.log(`Last updated: ${proxyStats.lastUpdated}`);
}

console.info(`[${USER_ID}] Starting with user with ${PROXIES.length} proxies...`);

function CoderMark() {
    if (!CoderMarkPrinted) {
        console.log(`\n\n
        ██████╗  ██████╗ ██╗███╗   ██╗████████╗███╗   ██╗███████╗███╗   ███╗ ██████╗ 
        ██╔══██╗██╔═══██╗██║████╗  ██║╚══██╔══╝████╗  ██║██╔════╝████╗ ████║██╔═══██╗
        ██████╔╝██║   ██║██║██╔██╗ ██║   ██║   ██╔██╗ ██║█████╗  ██╔████╔██║██║   ██║
        ██╔═══╝ ██║   ██║██║██║╚██╗██║   ██║   ██║╚██╗██║██╔══╝  ██║╚██╔╝██║██║   ██║
        ██║     ╚██████╔╝██║██║ ╚████║   ██║   ██║ ╚████║███████╗██║ ╚═╝ ██║╚██████╔╝
        ╚═╝      ╚═════╝ ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═══╝╚══════╝╚═╝     ╚═╝ ╚═════╝ 
        \n${chalk.green(`PointnemoGRASSminner`)} ${chalk.white(`Version last epoch`)}`);
        CoderMarkPrinted = true;
    }
}

async function main() {
  CoderMark();
  
  let PROXIES = await updateProxies();
  if (PROXIES.length === 0) {
    console.log(chalk.yellow('Using cached proxies as update failed'));
    PROXIES = fs.readFileSync('proxy.txt').toString().split('\n').map(proxy => proxy.trim()).filter(proxy => proxy);
  }

  console.log(chalk.blue('Validating proxies...'));
  await Promise.all(PROXIES.map(proxy => checkProxy(proxy)));
  await updateProxyList();
  
  console.log(chalk.green(`Working proxies: ${workingProxies.length}`));
  console.log(chalk.red(`Failed proxies: ${failedProxies.length}`));

  rl.question(`\n\n${chalk.yellow('Choose run option:')}\n\n${chalk.red('1. Run directly (without proxy)')}\n${chalk.green('2. Run with proxy (proxy.txt)')}\n${chalk.blue('3. Update Proxy')}\n${chalk.magenta('4. Update User Agent')}\n${chalk.cyan('5. Add Premium Proxies')}\n\nEnter your choice: `, async (answer) => {
    if (answer === '1') {
      await run(USER, null);
    } else if (answer === '2') {
      const proxyChunks = [];
      const chunkSize = Math.ceil(PROXIES.length / MAX_CONNECTIONS);
      for (let i = 0; i < PROXIES.length; i += chunkSize) {
        proxyChunks.push(PROXIES.slice(i, i + chunkSize));
      }

      const promises = proxyChunks.map(async (chunk) => {
        for (const proxy of chunk) {
          await sleep(getRandomInt(MIN_DELAY, MAX_DELAY));
          console.info(`[${USER.id}] Starting with proxy ${proxy}...`);
          try {
            await run(USER, proxy);
          } catch (error) {
            console.error(`[ERROR] Proxy ${proxy} failed:`, error);
            console.log(chalk.red(`Proxy ${proxy} failed`));
          }
        }
      });

      await Promise.all(promises);
    } else if (answer === '3') {
      await updateProxies();
      rl.close();
    } else if (answer === '4') {
      const latestUserAgents = await fetchLatestUserAgents();
      if (latestUserAgents.length > 0) {
        USER.userAgent = latestUserAgents[Math.floor(Math.random() * latestUserAgents.length)];
        console.log(chalk.green(`User Agent updated to latest version: ${USER.userAgent}`));
      } else {
        console.log(chalk.yellow('Using default user agent as fetching failed'));
      }
      rl.close();
    } else if (answer === '5') {
      await addPremiumProxies();
      rl.close();
    } else {
      console.log(chalk.red('Invalid option!'));
      rl.close();
    }
  });
}

async function addPremiumProxies() {
  rl.question(chalk.blue('Enter premium proxies (separate multiple proxies with comma): '), async (input) => {
    const newProxies = input.split(',')
      .map(proxy => proxy.trim())
      .filter(proxy => proxy);
    
    if (newProxies.length === 0) {
      console.log(chalk.red('No valid proxies entered!'));
      return;
    }

    let addedCount = 0;
    for (const proxy of newProxies) {
      const isValid = await checkProxy(proxy);
      if (isValid) {
        PROXIES.push(proxy);
        addedCount++;
      }
    }

    PROXIES = [...new Set(PROXIES)];
    fs.writeFileSync('proxy.txt', PROXIES.join('\n'));
    
    console.log(chalk.green(`Successfully added ${addedCount} premium proxies!`));
    console.log(chalk.blue('Updated proxy list:'));
    console.log(PROXIES.join('\n'));
  });
}

main().catch(console.error);
