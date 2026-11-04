/** Vite only: no production server imports, actor WebSocket or model workers. */
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../..', import.meta.url));
const server = await createServer({root, appType: 'mpa', server: {host: '127.0.0.1', port: 8775, strictPort: true, hmr: false,
  proxy: {'/api/manifest': 'http://127.0.0.1:8765', '/model': 'http://127.0.0.1:8765'}}});
await server.listen();
console.log(JSON.stringify({research_vite_ready: true, pid: process.pid, port: 8775, main_server_restarted: false}));
process.on('SIGINT', async () => {await server.close(); process.exit(0);});
