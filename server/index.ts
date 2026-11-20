import { createServer } from 'node:http';
import { createScenarioHttp } from './scenario-http.ts';

const api = createScenarioHttp(process.env, true);
const port = Number(process.env.D5_PORT || 8787);
const server = createServer((request, response) => {
  void api.handle(request, response, () => { response.writeHead(404); response.end(); });
});
server.once('close', api.close);
server.listen(port, '127.0.0.1', () => console.log('D5 API on loopback port ' + port));
