import { loadConfig } from './core/config.js';

const config = loadConfig();
console.log(`feed1 starting (prefix "${config.prefix}")`);
